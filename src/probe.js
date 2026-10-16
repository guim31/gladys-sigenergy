// -----------------------------------------------------------------------------
// The probe: what a Sigenergy system has, read once and kept in /data.
//
// - Each inverter: its model, serial number and firmware (the serial number
//   makes the external ids), its output type (single or three phases), its
//   PV string count, whether it has a battery, its rated power.
// - The plant: its rated powers and battery capacity, and which registers the
//   firmware implements. Registers were added to the protocol over the years
//   (30282 and 30284 in V2.7, 30286 in V2.9...): an older firmware answers
//   exception 2 for them, and the features they feed are left out.
//
// The plant has no serial number of its own: it takes the one of the first
// inverter of the configuration that answers ("plant-<serial>"), and keeps it
// in /data so that it never changes afterwards.
// -----------------------------------------------------------------------------

import { BlockReader } from './modbus/reader.js';
import {
  INVERTER,
  MAX_PV_STRINGS,
  PLANT,
  PLANT_SETTINGS,
  RESERVED,
  THREE_PHASE_OUTPUTS,
  decode,
  point,
  pvStringRegisters,
} from './sigenergy/registers.js';

export const LAYOUT_VERSION = 1;
export const READ_OPTIONS = { maxGap: 16, reserved: RESERVED };

/** The probe found something that prevents publishing (not a network error). */
export class ProbeError extends Error {
  constructor(code, params = {}) {
    super(code);
    this.name = 'ProbeError';
    this.code = code;
    this.params = params;
  }
}

/** Rounded up to the next kilowatt, at least 3 kW: the display bounds of a power. */
export function powerBound(...watts) {
  const max = Math.max(3000, ...watts.filter((w) => Number.isFinite(w)));
  return Math.ceil(max / 1000) * 1000;
}

/**
 * Read registers by name, through a block reader.
 * @returns {Promise<{ values: Record<string, unknown>, supported: string[], refused: string[] }>}
 */
export async function readNamed(connection, unitId, registers, reader = new BlockReader()) {
  const points = Object.entries(registers).map(([name, register]) => point(name, register));
  const results = await reader.readPoints(connection, unitId, points, READ_OPTIONS);
  const values = {};
  const supported = [];
  const refused = [];
  for (const [name, register] of Object.entries(registers)) {
    const result = results.get(name);
    if (Array.isArray(result)) {
      supported.push(name);
      values[name] = decode(register, result);
    } else {
      refused.push(name);
    }
  }
  return { values, supported, refused };
}

/**
 * Probe one inverter.
 * @param {import('./modbus/connection.js').ModbusConnection} connection
 * @param {number} unitId
 */
export async function probeInverter(connection, unitId) {
  const { values, supported } = await readNamed(connection, unitId, INVERTER);
  if (!supported.includes('serial') || !values.serial) {
    throw new ProbeError('notInverter', { unitId });
  }
  const pvStrings = Math.min(
    MAX_PV_STRINGS,
    Math.max(0, Number.isInteger(values.pvStringCount) ? values.pvStringCount : 0),
  );
  const strings = {};
  for (let n = 1; n <= pvStrings; n += 1) {
    const registers = pvStringRegisters(n);
    strings[`pv${n}Voltage`] = registers.voltage;
    strings[`pv${n}Current`] = registers.current;
  }
  const stringRead = pvStrings > 0 ? await readNamed(connection, unitId, strings) : null;
  const ratedW = Math.round((values.ratedActivePowerKw ?? 0) * 1000);
  return {
    version: LAYOUT_VERSION,
    unitId,
    serial: values.serial,
    model: values.model || '',
    firmware: values.firmware || '',
    ratedPowerW: ratedW,
    powerBoundW: powerBound(ratedW),
    hasBattery: (values.ratedBatteryKwh ?? 0) > 0 || (values.packCount ?? 0) > 0,
    phases: THREE_PHASE_OUTPUTS.has(values.outputType) ? 3 : 1,
    pvStrings,
    supported: [...supported, ...(stringRead?.supported ?? [])],
  };
}

/**
 * Probe the plant.
 * @param {import('./modbus/connection.js').ModbusConnection} connection
 * @param {number} unitId 247 unless the configuration says otherwise
 * @param {string} platformId "plant-<serial of the first inverter>"
 */
export async function probePlant(connection, unitId, platformId) {
  const { values, supported } = await readNamed(connection, unitId, PLANT);
  if (supported.length === 0) {
    throw new ProbeError('plantRefused', { unitId });
  }
  const settings = await readNamed(connection, unitId, PLANT_SETTINGS);
  const watts = (kw) => Math.round((kw ?? 0) * 1000);
  const maxActivePowerW = watts(values.maxActivePowerKw);
  const essRatedChargeW = watts(values.essRatedChargeKw);
  const essRatedDischargeW = watts(values.essRatedDischargeKw);
  const essCapacityKwh = values.essRatedCapacityKwh ?? 0;
  const bound = powerBound(maxActivePowerW, essRatedChargeW, essRatedDischargeW);
  const has = (name) => supported.includes(name);
  return {
    version: LAYOUT_VERSION,
    platformId,
    unitId,
    maxActivePowerW,
    essRatedChargeW,
    essRatedDischargeW,
    essCapacityKwh,
    hasBattery: essCapacityKwh > 0 || essRatedChargeW > 0,
    powerBoundW: bound,
    gridBoundW: bound * 2,
    houseSource: has('totalLoadPowerKw')
      ? 'total'
      : has('generalLoadPowerKw')
        ? 'general'
        : 'computed',
    settingsReadable: settings.supported.length === Object.keys(PLANT_SETTINGS).length,
    supported: [...supported, ...settings.supported],
  };
}
