// -----------------------------------------------------------------------------
// Modbus TCP frames: the PDU (function code + data) wrapped in the MBAP
// header. Sigenergy speaks plain Modbus TCP on port 502 (Sigenergy Modbus
// Protocol V2.9, section 3.2), so there is no RTU framing here.
//
// Reference: Modbus Application Protocol Specification V1.1b3 and Modbus
// Messaging on TCP/IP Implementation Guide V1.0b (modbus.org). Adapted from
// guim31/gladys-modbus (Apache-2.0, same author).
// -----------------------------------------------------------------------------

export const FUNCTION = {
  READ_HOLDING_REGISTERS: 3,
  READ_INPUT_REGISTERS: 4,
  WRITE_SINGLE_REGISTER: 6,
  WRITE_MULTIPLE_REGISTERS: 16,
};

/** The two register tables, and the function code that reads each. */
export const TABLES = {
  holding: FUNCTION.READ_HOLDING_REGISTERS,
  input: FUNCTION.READ_INPUT_REGISTERS,
};

/** Largest read Sigenergy accepts (section 6.1.1: 1 to 124 registers). */
export const MAX_READ = 124;

export const EXCEPTION_NAMES = {
  1: 'illegal function',
  2: 'illegal data address',
  3: 'illegal data value',
  4: 'server device failure',
  5: 'acknowledge',
  6: 'server device busy',
  10: 'gateway path unavailable',
  11: 'gateway target device failed to respond',
};

/** The device answered with a Modbus exception: it is reachable, the request is not. */
export class ModbusException extends Error {
  constructor(functionCode, code) {
    super(`Modbus exception ${code} (${EXCEPTION_NAMES[code] ?? 'unknown'})`);
    this.name = 'ModbusException';
    this.functionCode = functionCode;
    this.code = code;
  }
}

/**
 * Build a read request PDU.
 * @param {string} table holding | input
 * @param {number} address 0..65535
 * @param {number} count
 */
export function readRequest(table, address, count) {
  const functionCode = TABLES[table];
  if (functionCode === undefined) {
    throw new Error(`Unknown table ${table}`);
  }
  if (!Number.isInteger(count) || count < 1 || count > MAX_READ) {
    throw new RangeError(`Cannot read ${count} registers at once (1 to ${MAX_READ})`);
  }
  checkAddress(address, count);
  const pdu = Buffer.alloc(5);
  pdu.writeUInt8(functionCode, 0);
  pdu.writeUInt16BE(address, 1);
  pdu.writeUInt16BE(count, 3);
  return pdu;
}

/** Write one holding register (FC 6). */
export function writeRegisterRequest(address, word) {
  checkAddress(address, 1);
  const pdu = Buffer.alloc(5);
  pdu.writeUInt8(FUNCTION.WRITE_SINGLE_REGISTER, 0);
  pdu.writeUInt16BE(address, 1);
  pdu.writeUInt16BE(word & 0xffff, 3);
  return pdu;
}

/** Write consecutive holding registers (FC 16). */
export function writeRegistersRequest(address, words) {
  checkAddress(address, words.length);
  const pdu = Buffer.alloc(6 + words.length * 2);
  pdu.writeUInt8(FUNCTION.WRITE_MULTIPLE_REGISTERS, 0);
  pdu.writeUInt16BE(address, 1);
  pdu.writeUInt16BE(words.length, 3);
  pdu.writeUInt8(words.length * 2, 5);
  words.forEach((word, index) => pdu.writeUInt16BE(word & 0xffff, 6 + index * 2));
  return pdu;
}

function checkAddress(address, count) {
  if (!Number.isInteger(address) || address < 0 || address + count - 1 > 0xffff) {
    throw new RangeError(`Address ${address} is out of range (0 to 65535)`);
  }
}

/**
 * Check a response PDU against its request and extract the registers.
 * @param {Buffer} request the request PDU
 * @param {Buffer} response the response PDU
 * @returns {number[]} registers (0..65535) read; [] for a write
 * @throws {ModbusException} on an exception response
 */
export function parseResponse(request, response) {
  const functionCode = request[0];
  if (response.length < 2) {
    throw new Error('Truncated Modbus response');
  }
  if (response[0] === (functionCode | 0x80)) {
    throw new ModbusException(functionCode, response[1]);
  }
  if (response[0] !== functionCode) {
    throw new Error(`Unexpected function code ${response[0]} (expected ${functionCode})`);
  }
  if (
    functionCode === FUNCTION.READ_HOLDING_REGISTERS ||
    functionCode === FUNCTION.READ_INPUT_REGISTERS
  ) {
    const count = request.readUInt16BE(3);
    const byteCount = response[1];
    if (byteCount !== count * 2 || response.length < 2 + byteCount) {
      throw new Error(`Expected ${count} register(s), got ${byteCount} byte(s)`);
    }
    const words = [];
    for (let i = 0; i < count; i += 1) {
      words.push(response.readUInt16BE(2 + i * 2));
    }
    return words;
  }
  // A write answers an echo of its address (and value or quantity).
  if (response.length < 5 || response.readUInt16BE(1) !== request.readUInt16BE(1)) {
    throw new Error('The device did not confirm the write');
  }
  return [];
}

export const MBAP_LENGTH = 7;

/** Wrap a PDU in the MBAP header. */
export function encodeTcp(transactionId, unitId, pdu) {
  const frame = Buffer.alloc(MBAP_LENGTH + pdu.length);
  frame.writeUInt16BE(transactionId & 0xffff, 0);
  frame.writeUInt16BE(0, 2); // protocol identifier: Modbus
  frame.writeUInt16BE(pdu.length + 1, 4);
  frame.writeUInt8(unitId, 6);
  pdu.copy(frame, MBAP_LENGTH);
  return frame;
}

/**
 * Take the first complete MBAP frame out of a receive buffer.
 * @param {Buffer} buffer
 * @returns {{ frame?: { transactionId, unitId, pdu }, rest: Buffer }}
 */
export function decodeTcp(buffer) {
  if (buffer.length < MBAP_LENGTH) {
    return { rest: buffer };
  }
  const length = buffer.readUInt16BE(4);
  if (length < 2 || length > 254) {
    throw new Error(`Invalid Modbus TCP length ${length}`);
  }
  const total = 6 + length;
  if (buffer.length < total) {
    return { rest: buffer };
  }
  return {
    frame: {
      transactionId: buffer.readUInt16BE(0),
      unitId: buffer[6],
      pdu: buffer.subarray(MBAP_LENGTH, total),
    },
    rest: buffer.subarray(total),
  };
}
