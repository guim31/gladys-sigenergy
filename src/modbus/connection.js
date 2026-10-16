// -----------------------------------------------------------------------------
// One Modbus TCP connection to the Sigenergy system. The plant (unit 247) and
// every inverter (units 1 to 246) answer on the same address and port
// (Sigenergy Modbus Protocol V2.9, section 3.2), so they share it.
//
// - Requests run one at a time: the protocol asks the host to wait for the
//   answer, or for its timeout, before sending the next unicast request
//   (section 4.2, "minimum request period").
// - The connection opens on the first request and stays open; a request that
//   finds it closed reopens it, and one that fails because a reused
//   connection was reset is retried once on a fresh one.
// - A refused connection is not retried at every request: the next attempts
//   wait 1 s, 2 s, 4 s... up to a minute, and the requests in between fail at
//   once with the last error.
//
// Adapted from guim31/gladys-modbus (Apache-2.0, same author).
// -----------------------------------------------------------------------------

import net from 'node:net';
import {
  ModbusException,
  decodeTcp,
  encodeTcp,
  parseResponse,
  readRequest,
  writeRegisterRequest,
  writeRegistersRequest,
} from './frames.js';

const MAX_BACKOFF_MS = 60_000;
const BUSY_RETRY_MS = 500;

/** The connection failed or timed out: the system is not reachable. */
export class ModbusConnectionError extends Error {
  constructor(message, { cause } = {}) {
    super(message, { cause });
    this.name = 'ModbusConnectionError';
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class ModbusConnection {
  /**
   * @param {object} options
   * @param {string} options.host
   * @param {number} options.port
   * @param {number} [options.timeoutMs] per request, and to connect
   * @param {Function} [options.createSocket] test seam, net.createConnection by default
   * @param {() => number} [options.now]
   */
  constructor({
    host,
    port,
    timeoutMs = 3000,
    createSocket = (options) => net.createConnection(options),
    now = () => Date.now(),
  }) {
    this.host = host;
    this.port = port;
    this.timeoutMs = timeoutMs;
    this.createSocket = createSocket;
    this.now = now;

    this.socket = null;
    this.connecting = null;
    this.buffer = Buffer.alloc(0);
    this.pending = null;
    this.transactionId = 0;
    this.queue = Promise.resolve();
    this.closed = false;
    this.connectFailures = 0;
    this.retryAt = 0;
    this.lastConnectError = null;
  }

  get label() {
    return `${this.host}:${this.port}`;
  }

  /**
   * Read registers.
   * @param {number} unitId
   * @param {string} table holding | input
   * @param {number} address
   * @param {number} count
   * @returns {Promise<number[]>} registers (0..65535)
   */
  read(unitId, table, address, count) {
    return this.request(unitId, readRequest(table, address, count));
  }

  /** Writes one register with FC 6, several with FC 16. */
  writeRegisters(unitId, address, words) {
    return this.request(
      unitId,
      words.length === 1
        ? writeRegisterRequest(address, words[0])
        : writeRegistersRequest(address, words),
    );
  }

  /** Queue a request: it runs once the previous ones are done. */
  request(unitId, pdu) {
    const run = this.queue.then(() => this.exchange(unitId, pdu));
    this.queue = run.catch(() => {});
    return run;
  }

  async exchange(unitId, pdu, { retried = false } = {}) {
    if (this.closed) {
      throw new ModbusConnectionError(`Connection to ${this.label} closed`);
    }
    const reused = this.socket !== null;
    const socket = await this.open();
    try {
      const response = await this.send(socket, unitId, pdu);
      return parseResponse(pdu, response);
    } catch (err) {
      if (err instanceof ModbusException && (err.code === 5 || err.code === 6) && !retried) {
        // Acknowledge / busy: the device asks to come back a bit later.
        await sleep(BUSY_RETRY_MS);
        return this.exchange(unitId, pdu, { retried: true });
      }
      if (err.reset && reused && !retried) {
        // The device dropped the idle connection: once more on a fresh one.
        return this.exchange(unitId, pdu, { retried: true });
      }
      throw err;
    }
  }

  /** The open socket, connecting first when needed. */
  async open() {
    if (this.socket) {
      return this.socket;
    }
    if (this.connecting) {
      return this.connecting;
    }
    if (this.now() < this.retryAt && this.lastConnectError) {
      throw this.lastConnectError;
    }
    this.connecting = this.connect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const socket = this.createSocket({ host: this.host, port: this.port });
      const timer = setTimeout(() => {
        fail(new Error(`no answer within ${this.timeoutMs} ms`));
      }, this.timeoutMs);
      const fail = (err) => {
        clearTimeout(timer);
        socket.removeAllListeners();
        socket.on('error', () => {});
        socket.destroy();
        this.connectFailures += 1;
        this.retryAt =
          this.now() + Math.min(1000 * 2 ** (this.connectFailures - 1), MAX_BACKOFF_MS);
        this.lastConnectError = new ModbusConnectionError(
          `Cannot connect to ${this.label}: ${describe(err)}`,
          { cause: err },
        );
        reject(this.lastConnectError);
      };
      socket.once('error', fail);
      socket.once('connect', () => {
        clearTimeout(timer);
        socket.removeListener('error', fail);
        socket.setNoDelay?.(true);
        socket.setKeepAlive?.(true, 30_000);
        this.connectFailures = 0;
        this.retryAt = 0;
        this.lastConnectError = null;
        this.buffer = Buffer.alloc(0);
        socket.on('data', (chunk) => this.onData(chunk));
        socket.on('error', (err) => this.onClose(err));
        socket.on('close', () => this.onClose());
        this.socket = socket;
        resolve(socket);
      });
    });
  }

  /** Send one frame and wait for its answer (the response PDU). */
  send(socket, unitId, pdu) {
    return new Promise((resolve, reject) => {
      this.transactionId = (this.transactionId + 1) & 0xffff;
      const transactionId = this.transactionId;
      const timer = setTimeout(() => {
        this.pending = null;
        reject(
          new ModbusConnectionError(
            `No answer from ${this.label} (unit ${unitId}) within ${this.timeoutMs} ms`,
          ),
        );
      }, this.timeoutMs);
      this.pending = {
        unitId,
        functionCode: pdu[0],
        transactionId,
        resolve: (response) => {
          clearTimeout(timer);
          this.pending = null;
          resolve(response);
        },
        reject: (err) => {
          clearTimeout(timer);
          this.pending = null;
          reject(err);
        },
      };
      socket.write(encodeTcp(transactionId, unitId, pdu));
    });
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    try {
      for (;;) {
        const { frame, rest } = decodeTcp(this.buffer);
        this.buffer = rest;
        if (!frame) {
          return;
        }
        this.deliver(frame);
      }
    } catch (err) {
      // Garbage: resynchronize on the next answer.
      this.buffer = Buffer.alloc(0);
      this.pending?.reject(new ModbusConnectionError(`${this.label}: ${err.message}`));
    }
  }

  deliver(frame) {
    const pending = this.pending;
    if (!pending || frame.transactionId !== pending.transactionId) {
      return; // a late answer to a request that timed out
    }
    if ((frame.pdu[0] & 0x7f) !== pending.functionCode) {
      return;
    }
    pending.resolve(frame.pdu);
  }

  onClose(err) {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.on('error', () => {});
      this.socket.destroy();
    }
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    if (this.pending) {
      const error = new ModbusConnectionError(
        `Connection to ${this.label} lost${err ? `: ${describe(err)}` : ''}`,
        { cause: err },
      );
      error.reset = true;
      this.pending.reject(error);
    }
  }

  /** Close for good: pending and future requests fail. */
  close() {
    this.closed = true;
    this.onClose();
  }
}

/** A short, secret-free description of a socket error. */
function describe(err) {
  return err?.code ?? err?.message ?? String(err);
}

/** Whether an error means "nothing answers there" rather than "bad request". */
export function isUnreachable(err) {
  if (err instanceof ModbusConnectionError) {
    return true;
  }
  // 10/11: a gateway answered, but not the device behind it.
  return err instanceof ModbusException && (err.code === 10 || err.code === 11);
}
