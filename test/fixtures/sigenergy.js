// -----------------------------------------------------------------------------
// Simulated Sigenergy systems, built from the register tables of the
// "Sigenergy Modbus Protocol" V2.9: every documented register of the ranges
// read exists (0 unless set), the "Reserved" ranges do not (exception 2, like
// a register the firmware lacks).
//
// The serial numbers are invented; the values are consistent with each other
// (solar = battery charge + inverter output, home = output + grid).
// -----------------------------------------------------------------------------

import { createUnit } from '../helpers/fakeModbus.js';

/** Fill the documented plant registers of a firmware with zeros. */
function plantUnit({ v29 = true } = {}) {
  const unit = createUnit()
    .zeros('input', 30000, 73) // 30000-30072
    .zeros('input', 30083, 5) // 30083-30087
    .zeros('holding', 40000, 26) // 40000-40025
    .zeros('holding', 40029, 21); // 40029-40049
  if (v29) {
    unit.zeros('input', 30088, 200); // 30088-30287
  } else {
    // An older firmware (protocol V2.5): no lifetime totals of the plant, no
    // load power, no merged alarms 6 and 7. 30194-30223 exist (V2.6).
    unit.zeros('input', 30194, 30);
  }
  return unit;
}

function inverterUnit() {
  return createUnit()
    .zeros('input', 30500, 54) // 30500-30553
    .zeros('input', 30566, 44) // 30566-30609
    .zeros('input', 31000, 66); // 31000-31065
}

export const SERIAL_SP = 'SIGTEST0SP000001';
export const SERIAL_TP_1 = 'SIGTEST0TP000011';
export const SERIAL_TP_2 = 'SIGTEST0TP000012';

/**
 * A SigenStor EC 6.0 SP, single phase, 8 kWh battery, two PV strings, recent
 * firmware: 3.21 kW of solar, 1.122 kW into the battery, 2.088 kW out of the
 * inverter, 0.612 kW exported, 1.476 kW for the home.
 */
export function sigenStorSinglePhase() {
  const plant = plantUnit()
    .uint16('input', 30003, 0) // max self-consumption
    .uint16('input', 30004, 1)
    .int32('input', 30005, -612)
    .uint16('input', 30009, 0)
    .uint32('input', 30010, 6000)
    .uint16('input', 30014, 643)
    .int32('input', 30031, 2088)
    .int32('input', 30035, 3210)
    .int32('input', 30037, 1122)
    .uint16('input', 30051, 1)
    .uint32('input', 30066, 512)
    .uint32('input', 30068, 6000)
    .uint32('input', 30070, 6000)
    .uint32('input', 30083, 806)
    .uint16('input', 30087, 995)
    .uint64('input', 30088, 1234567)
    .uint64('input', 30094, 987654)
    .uint64('input', 30200, 345678)
    .uint64('input', 30204, 321098)
    .uint64('input', 30216, 432109)
    .uint64('input', 30220, 654321)
    .int32('input', 30282, 1476)
    .int32('input', 30284, 1476)
    .int16('input', 30286, 245)
    .uint16('holding', 40029, 0)
    .uint16('holding', 40031, 2)
    .uint32('holding', 40032, 6000)
    .uint32('holding', 40034, 6000);
  const inverter = inverterUnit()
    .string('input', 30500, 'SigenStor EC 6.0 SP', 15)
    .string('input', 30515, SERIAL_SP, 10)
    .string('input', 30525, 'V100R001C00SPC112', 15)
    .uint32('input', 30540, 6000)
    .uint32('input', 30548, 806)
    .uint16('input', 30578, 1)
    .int32('input', 30587, 2088)
    .int32('input', 30599, 1122)
    .uint16('input', 30601, 643)
    .uint16('input', 30602, 995)
    .int16('input', 30603, 245)
    .int16('input', 31003, 412)
    .uint16('input', 31004, 0) // L/N
    .uint32('input', 31011, 23150)
    .int32('input', 31017, 902)
    .uint16('input', 31024, 2)
    .uint16('input', 31025, 2)
    .uint16('input', 31026, 2)
    .int16('input', 31027, 3612)
    .int16('input', 31028, 512)
    .int16('input', 31029, 3580)
    .int16('input', 31030, -2) // a string at rest reads slightly negative
    .int32('input', 31035, 3210);
  return { 247: plant, 1: inverter };
}

/**
 * Two Sigen Hybrid 10.0 TP inverters (units 1 and 2), three phases, four PV
 * strings each, no battery, older firmware: the home power is computed.
 * 14.6 kW of solar, 7.3 kW per inverter, 2.1 kW for the home + 0.4 kW of a
 * third-party inverter, so 12.9 kW exported.
 */
export function hybridThreePhasePair() {
  const plant = plantUnit({ v29: false })
    .uint16('input', 30003, 0)
    .uint16('input', 30004, 1)
    .int32('input', 30005, -12900)
    .uint32('input', 30010, 20000)
    .int32('input', 30031, 14600)
    .int32('input', 30035, 14600)
    .uint16('input', 30051, 1)
    .uint16('input', 30027, 0b1000000000) // grid power outage (bit 9)
    .int32('input', 30194, 400)
    .uint64('input', 30216, 1000)
    .uint64('input', 30220, 5000);
  const inverter = (serial) =>
    inverterUnit()
      .string('input', 30500, 'Sigen Hybrid 10.0 TP', 15)
      .string('input', 30515, serial, 10)
      .string('input', 30525, 'V100R001C00SPC109', 15)
      .uint32('input', 30540, 10000)
      .uint16('input', 30578, 1)
      .int32('input', 30587, 7300)
      .int16('input', 31003, 385)
      .uint16('input', 31004, 2) // L1/L2/L3/N
      .uint32('input', 31011, 23010)
      .uint32('input', 31013, 23120)
      .uint32('input', 31015, 22980)
      .int32('input', 31017, 1058)
      .int32('input', 31019, 1061)
      .int32('input', 31021, 1049)
      .uint16('input', 31025, 4)
      .uint16('input', 31026, 2)
      .int16('input', 31027, 6021)
      .int16('input', 31028, 610)
      .int16('input', 31029, 6005)
      .int16('input', 31030, 608)
      .int16('input', 31031, 5980)
      .int16('input', 31032, 602)
      .int16('input', 31033, 5990)
      .int16('input', 31034, 604)
      .int32('input', 31035, 7300);
  return { 247: plant, 1: inverter(SERIAL_TP_1), 2: inverter(SERIAL_TP_2) };
}
