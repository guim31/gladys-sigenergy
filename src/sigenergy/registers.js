// -----------------------------------------------------------------------------
// The Sigenergy registers this integration reads and writes, transcribed from
// the "Sigenergy Modbus Protocol" V2.9 (2026-05-13), the document Sigenergy
// publishes for third-party controllers:
//
// - plant running information, input registers 30000+, unit 247 (table 5-1);
// - plant parameters, holding registers 40000+, unit 247 (tables 5-2-1 and
//   5-2-4), read with function 3 and written with functions 6 and 16;
// - hybrid inverter running information, input registers 30500+ and 31000+,
//   the inverter's own unit id 1..246 (table 5-3).
//
// Every value is big-endian, high word first. A value equals the raw integer
// divided by its gain ("Gain" column): a power of gain 1000 in kW is the raw
// integer in watts, an energy of gain 100 in kWh is the raw integer in
// hundredths of a kWh.
// -----------------------------------------------------------------------------

export const PLANT_UNIT_ID = 247;

/** The ranges the protocol marks "Reserved": a grouped read never spans them. */
export const RESERVED = [
  [30073, 30082],
  [30554, 30565],
  [30610, 30612],
  [40026, 40028],
  [40069, 40156],
];

/** Register counts of each data type (STRING has its own count). */
const COUNTS = { u16: 1, s16: 1, u32: 2, s32: 2, u64: 4 };

const input = (address, type, gain = 1, count = COUNTS[type]) => ({
  table: 'input',
  address,
  type,
  gain,
  count,
});
const holding = (address, type, gain = 1) => ({
  table: 'holding',
  address,
  type,
  gain,
  count: COUNTS[type],
});

/** Plant (unit 247), running information. */
export const PLANT = {
  emsWorkMode: input(30003, 'u16'),
  gridSensorStatus: input(30004, 'u16'),
  gridPowerKw: input(30005, 's32', 1000), // > 0 import, < 0 export
  onOffGrid: input(30009, 'u16'),
  maxActivePowerKw: input(30010, 'u32', 1000),
  socPercent: input(30014, 'u16', 10),
  alarm1: input(30027, 'u16'), // PCS alarms (appendix 2)
  alarm2: input(30028, 'u16'), // PCS alarms (appendix 3)
  alarm3: input(30029, 'u16'), // ESS alarms (appendix 4)
  alarm4: input(30030, 'u16'), // gateway alarms (appendix 5)
  activePowerKw: input(30031, 's32', 1000),
  pvPowerKw: input(30035, 's32', 1000),
  essPowerKw: input(30037, 's32', 1000), // > 0 charging, < 0 discharging
  runningState: input(30051, 'u16'),
  essAvailableDischargeKwh: input(30066, 'u32', 100),
  essRatedChargeKw: input(30068, 'u32', 1000),
  essRatedDischargeKw: input(30070, 'u32', 1000),
  alarm5: input(30072, 'u16'), // DC charger alarms (appendix 11)
  essRatedCapacityKwh: input(30083, 'u32', 100),
  sohPercent: input(30087, 'u16', 10),
  pvTotalKwh: input(30088, 'u64', 100),
  loadTotalKwh: input(30094, 'u64', 100),
  thirdPartyPowerKw: input(30194, 's32', 1000),
  essChargedKwh: input(30200, 'u64', 100),
  essDischargedKwh: input(30204, 'u64', 100),
  gridImportKwh: input(30216, 'u64', 100),
  gridExportKwh: input(30220, 'u64', 100),
  alarm6: input(30280, 'u16'), // plant alarms (appendix 12)
  alarm7: input(30281, 'u16'), // plant alarms (appendix 13)
  generalLoadPowerKw: input(30282, 's32', 1000),
  totalLoadPowerKw: input(30284, 's32', 1000),
};

/** Plant (unit 247), parameters: read with function 3. */
export const PLANT_SETTINGS = {
  remoteEmsEnable: holding(40029, 'u16'),
  remoteEmsMode: holding(40031, 'u16'),
  essMaxChargeKw: holding(40032, 'u32', 1000),
  essMaxDischargeKw: holding(40034, 'u32', 1000),
};

/** Hybrid inverter (its own unit id), running information. */
export const INVERTER = {
  model: input(30500, 'string', 1, 15),
  serial: input(30515, 'string', 1, 10),
  firmware: input(30525, 'string', 1, 15),
  ratedActivePowerKw: input(30540, 'u32', 1000),
  ratedBatteryKwh: input(30548, 'u32', 100),
  runningState: input(30578, 'u16'),
  activePowerKw: input(30587, 's32', 1000),
  essPowerKw: input(30599, 's32', 1000), // > 0 charging, < 0 discharging
  socPercent: input(30601, 'u16', 10),
  cellTemperature: input(30603, 's16', 10),
  alarm1: input(30605, 'u16'),
  alarm2: input(30606, 'u16'),
  alarm3: input(30607, 'u16'),
  alarm4: input(30608, 'u16'),
  alarm5: input(30609, 'u16'),
  pcsTemperature: input(31003, 's16', 10),
  outputType: input(31004, 'u16'), // 0 L/N, 1 L1/L2/L3, 2 L1/L2/L3/N, 3 L1/L2/N
  phaseAVoltage: input(31011, 'u32', 100),
  phaseBVoltage: input(31013, 'u32', 100),
  phaseCVoltage: input(31015, 'u32', 100),
  phaseACurrent: input(31017, 's32', 100),
  phaseBCurrent: input(31019, 's32', 100),
  phaseCCurrent: input(31021, 's32', 100),
  packCount: input(31024, 'u16'),
  pvStringCount: input(31025, 'u16'),
  pvPowerKw: input(31035, 's32', 1000),
};

/** Strings 1 to 4 at 31027, 5 to 16 at 31042 (voltage gain 10, current gain 100). */
export const MAX_PV_STRINGS = 16;
export function pvStringRegisters(n) {
  const base = n <= 4 ? 31027 + (n - 1) * 2 : 31042 + (n - 5) * 2;
  return { voltage: input(base, 's16', 10), current: input(base + 1, 's16', 100) };
}

/** Output types (31004) whose phases B and C carry values. */
export const THREE_PHASE_OUTPUTS = new Set([1, 2]);

/** A point of the block reader, from a register and its name. */
export function point(id, register) {
  return { id, table: register.table, address: register.address, count: register.count };
}

/**
 * The value of a register from its words.
 * @returns {number | string | undefined} undefined for a missing or "not valid" value
 */
export function decode(register, words) {
  if (!Array.isArray(words) || words.length < register.count) {
    return undefined;
  }
  switch (register.type) {
    case 'u16':
      return words[0] / register.gain;
    case 's16':
      return (words[0] >= 0x8000 ? words[0] - 0x10000 : words[0]) / register.gain;
    case 'u32': {
      const raw = words[0] * 0x10000 + words[1];
      // 0xFFFFFFFF: "register is not valid" (40042, 40044)
      return raw === 0xffffffff ? undefined : raw / register.gain;
    }
    case 's32': {
      const raw = words[0] * 0x10000 + words[1];
      return (raw >= 0x80000000 ? raw - 0x100000000 : raw) / register.gain;
    }
    case 'u64': {
      const raw = words
        .slice(0, 4)
        .reduce((total, word) => (total << 16n) | BigInt(word & 0xffff), 0n);
      if (raw === 0xffffffffffffffffn) {
        return undefined;
      }
      return Number(raw) / register.gain;
    }
    case 'string': {
      const buffer = Buffer.alloc(register.count * 2);
      words.slice(0, register.count).forEach((word, i) => buffer.writeUInt16BE(word, i * 2));
      // NUL-padded ASCII; keep printable characters only.
      return buffer
        .toString('latin1')
        .replace(/\0[\s\S]*$/, '')
        .replace(/[^\x20-\x7e]/g, '')
        .trim();
    }
    default:
      throw new Error(`Unknown data type ${register.type}`);
  }
}

/** The words to write for a value, in the register's type and gain. */
export function encode(register, value) {
  const raw = Math.round(value * register.gain);
  switch (register.type) {
    case 'u16':
      if (raw < 0 || raw > 0xffff) {
        throw new RangeError(`${value} does not fit register ${register.address}`);
      }
      return [raw];
    case 'u32':
      if (raw < 0 || raw > 0xfffffffe) {
        throw new RangeError(`${value} does not fit register ${register.address}`);
      }
      return [Math.floor(raw / 0x10000), raw % 0x10000];
    default:
      throw new Error(`Writing a ${register.type} is not supported`);
  }
}
