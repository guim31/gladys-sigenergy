// -----------------------------------------------------------------------------
// Grouped reads.
//
// A device is read in as few requests as possible: the points (one value
// each: a register or a run of registers) of the same table that are close to
// each other are read in one request, up to `maxRegisters` registers. A read
// never spans a range the protocol marks "Reserved".
//
// A register the firmware does not implement answers Modbus exception 2
// ("illegal data address"), and so does any grouped read that covers it
// (registers added in later versions of the protocol, 30282 or 30284 on an
// older firmware). So a grouped read that fails that way is split: its points
// are read one by one, now and in the next cycles (the split is remembered),
// and only the points that fail on their own are reported missing.
//
// Adapted from guim31/gladys-modbus (Apache-2.0, same author).
// -----------------------------------------------------------------------------

import { MAX_READ, ModbusException } from './frames.js';
import { isUnreachable } from './connection.js';

/** Exceptions that mean "not here" rather than "the device is down". */
const ADDRESS_EXCEPTIONS = new Set([1, 2, 3, 4]);

/**
 * Group points into reads.
 * @param {Array<{ id, table, address, count }>} points
 * @param {object} [options]
 * @param {number} [options.maxRegisters] registers per request
 * @param {number} [options.maxGap] unused addresses a read may span between two points
 * @param {Array<[number, number]>} [options.reserved] inclusive ranges a read never spans
 * @returns {Array<{ table, address, count, points }>}
 */
export function planReads(points, { maxRegisters = MAX_READ, maxGap = 0, reserved = [] } = {}) {
  const sorted = [...points].sort(
    (a, b) => a.table.localeCompare(b.table) || a.address - b.address || b.count - a.count,
  );
  const crossesReserved = (from, to) =>
    from <= to && reserved.some(([start, end]) => start <= to && end >= from);
  const blocks = [];
  let current = null;
  for (const point of sorted) {
    const end = point.address + point.count - 1;
    const currentEnd = current ? current.address + current.count - 1 : 0;
    if (
      current &&
      current.table === point.table &&
      point.address <= currentEnd + 1 + maxGap &&
      Math.max(end, currentEnd) - current.address + 1 <= maxRegisters &&
      !crossesReserved(currentEnd + 1, point.address - 1)
    ) {
      current.count = Math.max(end, currentEnd) - current.address + 1;
      current.points.push(point);
      continue;
    }
    current = { table: point.table, address: point.address, count: point.count, points: [point] };
    blocks.push(current);
  }
  return blocks;
}

export class BlockReader {
  constructor() {
    /** Blocks known to fail as a whole, by unit, table, address and length. */
    this.splitBlocks = new Set();
  }

  /** Forget the splits (new configuration, firmware update). */
  reset() {
    this.splitBlocks.clear();
  }

  /**
   * Read every point.
   * @param {import('./connection.js').ModbusConnection} connection
   * @param {number} unitId
   * @param {Array<{ id, table, address, count }>} points
   * @param {object} [options] planReads options
   * @returns {Promise<Map<string, number[] | Error>>} the words of each point, or why it failed
   * @throws when the device does not answer at all
   */
  async readPoints(connection, unitId, points, options) {
    const results = new Map();
    for (const block of planReads(points, options)) {
      const key = `${unitId}:${block.table}:${block.address}:${block.count}`;
      if (block.points.length > 1 && this.splitBlocks.has(key)) {
        await this.readOneByOne(connection, unitId, block.points, results);
        continue;
      }
      try {
        const words = await connection.read(unitId, block.table, block.address, block.count);
        for (const point of block.points) {
          const start = point.address - block.address;
          results.set(point.id, words.slice(start, start + point.count));
        }
      } catch (err) {
        if (isUnreachable(err) || !isAddressError(err)) {
          throw err;
        }
        if (block.points.length > 1) {
          this.splitBlocks.add(key);
          await this.readOneByOne(connection, unitId, block.points, results);
        } else {
          results.set(block.points[0].id, err);
        }
      }
    }
    return results;
  }

  async readOneByOne(connection, unitId, points, results) {
    for (const point of points) {
      try {
        results.set(
          point.id,
          await connection.read(unitId, point.table, point.address, point.count),
        );
      } catch (err) {
        if (isUnreachable(err) || !isAddressError(err)) {
          throw err;
        }
        results.set(point.id, err);
      }
    }
  }
}

export function isAddressError(err) {
  return err instanceof ModbusException && ADDRESS_EXCEPTIONS.has(err.code);
}
