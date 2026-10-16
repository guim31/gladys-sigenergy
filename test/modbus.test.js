// -----------------------------------------------------------------------------
// The Modbus layer and the Sigenergy register map: frames as the protocol's
// own examples show them (section 6.1), the decoding of every data type, the
// grouped reads that never span a reserved range and split around a register
// the firmware lacks, the enumerations and alarm bits.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModbusConnection } from '../src/modbus/connection.js';
import {
  ModbusException,
  decodeTcp,
  encodeTcp,
  parseResponse,
  readRequest,
  writeRegistersRequest,
} from '../src/modbus/frames.js';
import { BlockReader, planReads } from '../src/modbus/reader.js';
import {
  INVERTER,
  PLANT,
  PLANT_SETTINGS,
  RESERVED,
  decode,
  encode,
  pvStringRegisters,
} from '../src/sigenergy/registers.js';
import { activeAlarms, controlModeOf, enumText, RUNNING_STATES } from '../src/sigenergy/enums.js';
import { alarmList, limitStep } from '../src/model.js';
import { normalizeConfig, parseUnitIds, readTarget } from '../src/config.js';
import { closedPort, createFakeModbusServer, createUnit } from './helpers/fakeModbus.js';

const hex = (buffer) => buffer.toString('hex').toUpperCase();

test('the requests of the protocol examples (section 6.1)', () => {
  // "Read the Rated active power register of the hybrid inverter": 77 4C 00 02
  assert.equal(hex(readRequest('holding', 30540, 2)), '03774C0002');
  // "Write the Active power fixed adjustment target value of the plant"
  assert.equal(hex(writeRegistersRequest(40001, [0, 0x61a8])), '109C41000204000061A8');
  // The answer 00 00 61 A8 is 25.000 kW at gain 1000.
  const words = parseResponse(
    readRequest('input', 30540, 2),
    Buffer.from('04040000' + '61A8', 'hex'),
  );
  assert.deepEqual(words, [0, 0x61a8]);
  assert.equal(decode(INVERTER.ratedActivePowerKw, words), 25);
  assert.throws(
    () => parseResponse(readRequest('input', 30540, 2), Buffer.from('8404', 'hex')),
    (err) => err instanceof ModbusException && err.code === 4,
  );
  assert.throws(() => readRequest('input', 30000, 125), RangeError);
});

test('MBAP frames round-trip', () => {
  const frame = encodeTcp(7, 247, readRequest('input', 30035, 2));
  const { frame: decoded, rest } = decodeTcp(Buffer.concat([frame, Buffer.from([1])]));
  assert.equal(decoded.transactionId, 7);
  assert.equal(decoded.unitId, 247);
  assert.equal(hex(decoded.pdu), '0475530002');
  assert.equal(rest.length, 1);
});

test('every data type of the protocol decodes, big-endian, high word first', () => {
  assert.equal(decode(PLANT.socPercent, [643]), 64.3);
  assert.equal(decode(INVERTER.cellTemperature, [0xff9c]), -10);
  assert.equal(decode(PLANT.gridPowerKw, [0xffff, 0xfd9c]), -0.612);
  assert.equal(decode(PLANT.essRatedChargeKw, [0, 6000]), 6);
  assert.equal(decode(PLANT.essRatedChargeKw, [0xffff, 0xffff]), undefined, 'not valid');
  assert.equal(decode(PLANT.pvTotalKwh, [0, 0, 0x12, 0xd687]), 12345.67);
  assert.equal(decode(PLANT.pvTotalKwh, [0xffff, 0xffff, 0xffff, 0xffff]), undefined);
  const serial = Buffer.alloc(20);
  serial.write('SIGTEST0SP000001');
  const words = [];
  for (let i = 0; i < 20; i += 2) words.push(serial.readUInt16BE(i));
  assert.equal(decode(INVERTER.serial, words), 'SIGTEST0SP000001');
  assert.equal(decode(PLANT.socPercent, []), undefined);
  assert.deepEqual(encode(PLANT_SETTINGS.essMaxChargeKw, 3.5), [0, 3500]);
  assert.deepEqual(encode(PLANT_SETTINGS.essMaxChargeKw, 70), [1, 4464]);
  assert.throws(() => encode(PLANT_SETTINGS.remoteEmsEnable, -1), RangeError);
});

test('the PV strings: 1 to 4 at 31027, 5 to 16 at 31042', () => {
  assert.equal(pvStringRegisters(1).voltage.address, 31027);
  assert.equal(pvStringRegisters(4).current.address, 31034);
  assert.equal(pvStringRegisters(5).voltage.address, 31042);
  assert.equal(pvStringRegisters(16).current.address, 31065);
});

test('grouped reads never span a reserved range', () => {
  const points = [
    { id: 'a', table: 'input', address: 30072, count: 1 },
    { id: 'b', table: 'input', address: 30083, count: 2 },
    { id: 'c', table: 'input', address: 30087, count: 1 },
  ];
  const blocks = planReads(points, { maxGap: 16, reserved: RESERVED });
  assert.deepEqual(
    blocks.map((block) => [block.address, block.count]),
    [
      [30072, 1],
      [30083, 5],
    ],
  );
});

test('a grouped read refused by the firmware is split, and the split remembered', async () => {
  const unit = createUnit().zeros('input', 30280, 2).uint16('input', 30284, 1);
  const server = await createFakeModbusServer({ units: { 247: unit } });
  const connection = new ModbusConnection({ host: server.host, port: server.port, timeoutMs: 500 });
  try {
    const reader = new BlockReader();
    const points = [
      { id: 'alarm6', table: 'input', address: 30280, count: 1 },
      { id: 'general', table: 'input', address: 30282, count: 2 },
      { id: 'total', table: 'input', address: 30284, count: 1 },
    ];
    const first = await reader.readPoints(connection, 247, points, { maxGap: 4 });
    assert.deepEqual(first.get('alarm6'), [0]);
    assert.ok(first.get('general') instanceof ModbusException);
    assert.deepEqual(first.get('total'), [1]);
    const before = server.requests.length;
    await reader.readPoints(connection, 247, points, { maxGap: 4 });
    assert.equal(server.requests.length - before, 3, 'one by one at once, without the big read');
  } finally {
    connection.close();
    await server.close();
  }
});

test('a closed port fails fast, then waits before trying again', async () => {
  const port = await closedPort();
  const connection = new ModbusConnection({ host: '127.0.0.1', port, timeoutMs: 500 });
  await assert.rejects(connection.read(247, 'input', 30000, 1), /Cannot connect/);
  const started = Date.now();
  await assert.rejects(connection.read(247, 'input', 30000, 1), /Cannot connect/);
  assert.ok(Date.now() - started < 100, 'the second attempt is not even tried');
  connection.close();
});

test('enumerations and alarms', () => {
  assert.equal(enumText(RUNNING_STATES, 7, 'fr'), 'Anomalie environnementale');
  assert.equal(enumText(RUNNING_STATES, 42, 'de'), 'Unbekannt (42)');
  assert.equal(controlModeOf(0, 3), 'auto');
  assert.equal(controlModeOf(1, 3), 'charge_grid');
  assert.equal(controlModeOf(1, 0), undefined, 'PCS remote control is not offered');
  const alarms = activeAlarms([
    { table: 'pcs1', address: 30027, value: 0b1000000100 },
    { table: 'ess', address: 30029, value: 0 },
    { table: 'plant1', address: 30280, value: 1 << 15 },
  ]);
  assert.deepEqual(
    alarms.map((alarm) => alarm.text.fr),
    ['Onduleur : surchauffe', 'Onduleur : coupure du réseau', 'Installation : alarme 30280.15'],
  );
  assert.equal(alarmList([], 'es'), 'Ninguna');
  assert.equal(alarmList(alarms, 'en').split(' ; ').length, 3);
});

test('a limit reads as the nearest step of the rated power', () => {
  assert.equal(limitStep(6000, 6000), '100');
  assert.equal(limitStep(3300, 6000), '60');
  assert.equal(limitStep(9000, 6000), '100');
  assert.equal(limitStep(undefined, 6000), undefined);
  assert.equal(limitStep(1000, 0), undefined);
});

test('the configuration: unit ids, host and defaults', () => {
  assert.deepEqual(parseUnitIds('1, 2;3 3').ids, [1, 2, 3]);
  assert.deepEqual(
    parseUnitIds('0, x, 247').errors.map((error) => error.code),
    ['badInverterUnitId', 'badInverterUnitId', 'badInverterUnitId'],
  );
  assert.equal(parseUnitIds('5', 5).errors[0].code, 'inverterIsPlant');
  assert.equal(parseUnitIds('1,2,3,4,5,6,7,8,9').ids.length, 8);
  const config = normalizeConfig({ host: ' 192.0.2.10 ', poll_interval: 7, language: 'it' });
  assert.equal(config.host, '192.0.2.10');
  assert.equal(config.poll_interval, '15');
  assert.equal(config.language, 'fr');
  assert.equal(config.allow_control, false);
  assert.deepEqual(readTarget(config).target, {
    host: '192.0.2.10',
    port: 502,
    plantUnitId: 247,
    inverterUnitIds: [1],
  });
  assert.equal(readTarget(normalizeConfig({ host: 'http://x' })).errors[0].code, 'badHost');
  assert.equal(readTarget(normalizeConfig({ host: 'a', port: 70000 })).errors[0].code, 'badPort');
});
