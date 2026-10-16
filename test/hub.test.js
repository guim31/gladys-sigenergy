// -----------------------------------------------------------------------------
// The life of the integration: the container's own polling (no onPoll), the
// core's poll as a fallback, the values and the indexes, a system that stops
// and starts answering, the alarms, the logs, /data, the wrong unit ids.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLANT_EN, PLANT_FR, captureLogs, createWorld } from './helpers/world.js';
import { SERIAL_SP, hybridThreePhasePair, sigenStorSinglePhase } from './fixtures/sigenergy.js';
import { MemoryStore } from '../src/store.js';
import { HEARTBEAT_MS, TRIGGERS } from '../src/hub.js';
import { RESERVED } from '../src/sigenergy/registers.js';

const INVERTER = 'SigenStor EC 6.0 SP';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('the system is discovered and every value is published once the devices are added', async () => {
  const world = await createWorld({ units: sigenStorSinglePhase() });
  try {
    assert.deepEqual(
      world.fake.discoveredDevices.map((device) => device.name),
      [PLANT_FR, INVERTER],
    );
    const plant = world.device(PLANT_FR);
    assert.ok(plant.external_id.includes(SERIAL_SP), 'the plant is named after the serial number');
    assert.equal(world.state(PLANT_FR, 'pv_power'), 3210);
    assert.equal(world.state(PLANT_FR, 'house_power'), 1476);
    assert.equal(world.state(PLANT_FR, 'grid_power'), -612);
    assert.equal(world.state(PLANT_FR, 'grid_import_power'), 0);
    assert.equal(world.state(PLANT_FR, 'grid_export_power'), 612);
    assert.equal(world.state(PLANT_FR, 'battery_level'), 64.3);
    assert.equal(world.state(PLANT_FR, 'battery_charge_power'), 1122);
    assert.equal(world.state(PLANT_FR, 'battery_discharge_power'), 0);
    assert.equal(world.state(PLANT_FR, 'battery_energy_remaining'), 5.12);
    assert.equal(world.state(PLANT_FR, 'battery_health'), 99.5);
    assert.equal(world.state(PLANT_FR, 'pv_index'), 12345.67);
    assert.equal(world.state(PLANT_FR, 'house_index'), 9876.54);
    assert.equal(world.state(PLANT_FR, 'grid_import_index'), 4321.09);
    assert.equal(world.state(PLANT_FR, 'grid_export_index'), 6543.21);
    assert.equal(world.state(PLANT_FR, 'ems_mode'), 'Autoconsommation maximale');
    assert.equal(world.state(PLANT_FR, 'plant_state'), 'En marche');
    assert.equal(world.state(PLANT_FR, 'off_grid'), 0);
    assert.equal(world.state(PLANT_FR, 'alarm'), 0);
    assert.equal(world.state(PLANT_FR, 'alarms'), 'Aucune');
    assert.equal(world.state(INVERTER, 'active_power'), 2088);
    assert.equal(world.state(INVERTER, 'voltage'), 231.5);
    assert.equal(world.state(INVERTER, 'pv1_voltage'), 361.2);
    assert.equal(world.state(INVERTER, 'pv2_current'), 0, 'no phantom negative current');
    assert.equal(world.state(INVERTER, 'pcs_temperature'), 41.2);
    assert.equal(world.state(INVERTER, 'battery_temperature'), 24.5);
    assert.equal(world.state(INVERTER, 'inverter_state'), 'En marche');
    const status = world.fake.connectionStatus;
    assert.equal(status.connected, true);
    assert.match(status.message.fr, /1 onduleur/);
    assert.match(status.message.fr, /Lecture seule/);
  } finally {
    await world.stop();
  }
});

test('the states refresh with the container timer alone, never waiting for onPoll', async (t) => {
  const units = sigenStorSinglePhase();
  const world = await createWorld({ units, timers: true });
  try {
    const polls = t.mock.method(world.app.poller, 'pollFromCore');
    // The configured interval (10 s at least) made short, the timer unchanged.
    t.mock.method(world.hub, 'effectiveIntervalMs', () => 40);
    world.app.poller.stop();
    await world.app.poller.restart();
    assert.equal(world.state(PLANT_FR, 'pv_power'), 3210);
    units[247].int32('input', 30035, 4500);
    for (let i = 0; i < 100 && world.state(PLANT_FR, 'pv_power') !== 4500; i += 1) {
      await wait(20);
    }
    assert.equal(world.state(PLANT_FR, 'pv_power'), 4500);
    assert.equal(polls.mock.callCount(), 0, 'no onPoll was involved');
  } finally {
    world.app.poller.stop();
    await world.stop();
  }
});

test('the core poll is a fallback: right after a cycle it does not read again', async () => {
  const world = await createWorld({ units: sigenStorSinglePhase() });
  try {
    const before = world.server.requests.length;
    const ack = await world.fake.poll(world.device(PLANT_FR));
    assert.equal(ack.success, true);
    assert.equal(world.server.requests.length, before, 'no request: the timer just read');
  } finally {
    await world.stop();
  }
});

test('only the changes are published, with a heartbeat of at most 12 hours', async (t) => {
  const world = await createWorld({ units: sigenStorSinglePhase() });
  try {
    const calls = [];
    const original = world.gladys.publishChangedStates.bind(world.gladys);
    t.mock.method(world.gladys, 'publishChangedStates', async (states, options) => {
      calls.push({ states, options });
      return original(states, options);
    });
    const published = world.fake.states.length;
    await world.app.poller.cycle({ force: true });
    assert.equal(world.fake.states.length, published, 'nothing changed, nothing sent');
    assert.ok(calls.every((call) => call.options.heartbeat === HEARTBEAT_MS));
    assert.ok(HEARTBEAT_MS <= 12 * 60 * 60 * 1000);
  } finally {
    await world.stop();
  }
});

test('a normal cycle writes nothing at the info level, and no address with credentials', async (t) => {
  const world = await createWorld({ units: sigenStorSinglePhase() });
  try {
    world.server.units[247].int32('input', 30035, 3333);
    const lines = await captureLogs(t, () => world.app.poller.cycle({ force: true }));
    assert.deepEqual(lines, []);
    const debug = await captureLogs(t, () => world.app.poller.cycle({ force: true }), 'debug');
    assert.ok(debug.length > 0, 'LOG_LEVEL=debug shows the cycle');
  } finally {
    await world.stop();
  }
});

test('a host typed with credentials is refused and never logged', async (t) => {
  let world;
  const lines = await captureLogs(
    t,
    async () => {
      world = await createWorld({
        units: sigenStorSinglePhase(),
        config: () => ({ host: 'admin:s3cret@192.0.2.10' }),
      });
    },
    'debug',
  );
  try {
    assert.ok(!lines.join('\n').includes('s3cret'));
    assert.ok(!JSON.stringify(world.fake.connectionStatuses).includes('s3cret'));
    assert.equal(world.fake.connectionStatus.connected, false);
    assert.equal(world.fake.discoveredDevices.length, 0);
  } finally {
    await world.stop();
  }
});

test('an index is never published lower than before, nor at 0', async () => {
  const world = await createWorld({ units: sigenStorSinglePhase() });
  const plant = world.server.units[247];
  try {
    plant.uint64('input', 30094, 0); // a transient 0
    await world.app.poller.cycle({ force: true });
    assert.equal(world.state(PLANT_FR, 'house_index'), 9876.54);
    plant.uint64('input', 30094, 987000); // lower
    await world.app.poller.cycle({ force: true });
    assert.equal(world.state(PLANT_FR, 'house_index'), 9876.54);
    plant.uint64('input', 30094, 987700);
    await world.app.poller.cycle({ force: true });
    assert.equal(world.state(PLANT_FR, 'house_index'), 9877);
  } finally {
    await world.stop();
  }
});

test('a system that stops answering: one warning, one trigger, the status; and back', async (t) => {
  const world = await createWorld({ units: sigenStorSinglePhase() });
  try {
    world.server.behaviour.mute = true;
    const lost = await captureLogs(t, async () => {
      await world.app.poller.cycle({ force: true });
      await world.app.poller.cycle({ force: true });
      await world.app.poller.cycle({ force: true });
    });
    assert.equal(lost.filter((line) => /does not answer/.test(line)).length, 1);
    const events = () => world.fake.sceneEvents.map((event) => event.key);
    assert.deepEqual(events(), [TRIGGERS.UNREACHABLE]);
    assert.equal(world.fake.connectionStatus.connected, false);
    assert.match(world.fake.connectionStatus.message.fr, /ne répond pas/);
    assert.equal(world.fake.sceneEvents[0].data.device, world.device(PLANT_FR).external_id);

    world.server.behaviour.mute = false;
    const back = await captureLogs(t, () => world.app.poller.cycle({ force: true }));
    assert.equal(back.filter((line) => /answers again/.test(line)).length, 1);
    assert.deepEqual(events(), [TRIGGERS.UNREACHABLE, TRIGGERS.REACHABLE]);
    assert.equal(world.fake.connectionStatus.connected, true);
  } finally {
    await world.stop();
  }
});

test('a new alarm fires alarm_raised with its text, once', async () => {
  const world = await createWorld({
    units: sigenStorSinglePhase(),
    config: () => ({ language: 'en' }),
  });
  try {
    world.server.units[247].uint16('input', 30029, 0b100); // ESS over-temperature
    await world.app.poller.cycle({ force: true });
    await world.app.poller.cycle({ force: true });
    const alarms = world.fake.sceneEvents.filter((event) => event.key === TRIGGERS.ALARM);
    assert.equal(alarms.length, 1);
    assert.equal(alarms[0].data.alarm, 'Battery: over-temperature');
    assert.equal(alarms[0].data.device_name, PLANT_EN);
    assert.equal(world.state(PLANT_EN, 'alarm'), 1);
    assert.equal(world.state(PLANT_EN, 'alarms'), 'Battery: over-temperature');
  } finally {
    await world.stop();
  }
});

test('an older firmware, three phases, two inverters, no battery: the home power is computed', async () => {
  const world = await createWorld({
    units: hybridThreePhasePair(),
    config: () => ({ language: 'en', inverter_unit_ids: '1, 2' }),
  });
  try {
    const names = world.fake.discoveredDevices.map((device) => device.name);
    assert.deepEqual(names, [PLANT_EN, 'Sigen Hybrid 10.0 TP #1', 'Sigen Hybrid 10.0 TP #2']);
    // 14.6 kW out of the inverters, 12.9 kW exported, 0.4 kW of a third-party inverter.
    assert.equal(world.state(PLANT_EN, 'house_power'), 2100);
    const keys = world.device(PLANT_EN).features.map((f) => f.external_id.split(':').pop());
    assert.ok(!keys.includes('battery_level'), 'no battery, no battery feature');
    assert.ok(!keys.includes('pv_index'), 'a register the firmware lacks, no feature');
    assert.ok(keys.includes('grid_import_index'));
    // An alarm already active at startup is shown, but is no news for scenes.
    assert.equal(world.state(PLANT_EN, 'alarms'), 'Inverter: grid power outage');
    assert.equal(world.fake.sceneEvents.length, 0);
    const inverter = world.device('Sigen Hybrid 10.0 TP #2');
    const features = inverter.features.map((f) => f.name);
    for (const name of ['Voltage L1', 'Voltage L3', 'Current L2', 'PV4 voltage', 'PV4 current']) {
      assert.ok(features.includes(name), name);
    }
    assert.equal(world.state('Sigen Hybrid 10.0 TP #2', 'voltage_l3'), 229.8);
  } finally {
    await world.stop();
  }
});

test('no grouped read ever spans a reserved range, and a cycle stays short', async () => {
  const world = await createWorld({ units: sigenStorSinglePhase() });
  try {
    const before = world.server.requests.length;
    await world.app.poller.cycle({ force: true });
    const cycle = world.server.requests.slice(before);
    assert.ok(cycle.length <= 20, `${cycle.length} requests in one cycle`);
    for (const request of world.server.requests) {
      const end = request.address + request.count - 1;
      for (const [start, last] of RESERVED) {
        assert.ok(
          end < start || request.address > last,
          `read ${request.address}+${request.count}`,
        );
      }
      assert.ok(request.count <= 124);
      assert.ok([3, 4].includes(request.functionCode), 'reads only');
    }
  } finally {
    await world.stop();
  }
});

test('the devices are kept in /data: a restart while the system is silent publishes them', async () => {
  const store = new MemoryStore();
  const first = await createWorld({ units: sigenStorSinglePhase(), store });
  const ids = first.fake.discoveredDevices.map((device) => device.external_id);
  await first.stop();
  const second = await createWorld({
    units: sigenStorSinglePhase(),
    store,
    server: { silentUnits: new Set([1, 247]) },
  });
  try {
    assert.deepEqual(
      second.fake.discoveredDevices.map((device) => device.external_id),
      ids,
    );
    assert.equal(second.fake.connectionStatus.connected, false);
  } finally {
    await second.stop();
  }
});

test('a wrong inverter unit id: the plant answers, the status says so, the test button finds it', async () => {
  const world = await createWorld({
    units: sigenStorSinglePhase(),
    config: () => ({ language: 'en', inverter_unit_ids: '5' }),
  });
  try {
    assert.equal(world.fake.discoveredDevices.length, 0);
    assert.equal(world.fake.connectionStatus.connected, false);
    assert.match(world.fake.connectionStatus.message.en, /No inverter answers at unit id\(s\) 5/);
    const ack = await world.fake.action('test_connection', {});
    assert.equal(ack.success, true, ack.error);
    assert.match(ack.data.message.en, /Plant \(unit 247\): answers/);
    assert.match(ack.data.message.en, /Inverters found at unit id\(s\) 1:/);
    assert.ok(!ack.data.message.en.includes(SERIAL_SP), 'the serial number is masked');
  } finally {
    await world.stop();
  }
});

test('the test button reports the configured inverters and the control registers', async () => {
  const world = await createWorld({
    units: sigenStorSinglePhase(),
    config: () => ({ language: 'fr' }),
  });
  try {
    const ack = await world.fake.action('test_connection', {});
    assert.equal(ack.success, true, ack.error);
    assert.match(ack.data.message.fr, /Onduleur 1 : SigenStor EC 6.0 SP, n° de série …0001/);
    assert.match(ack.data.message.fr, /Solaire 3,21 kW/);
    assert.match(ack.data.message.fr, /registres de pilotage de la batterie sont lisibles/);
  } finally {
    await world.stop();
  }
});

test('an unconfigured integration says what to enter, and the test button refuses', async () => {
  const world = await createWorld({ units: null, config: () => ({ language: 'en' }) });
  try {
    assert.equal(world.fake.connectionStatus.connected, false);
    assert.match(world.fake.connectionStatus.message.en, /Enter the address/);
    const ack = await world.fake.action('test_connection', {});
    assert.equal(ack.success, false);
    assert.match(ack.error, /Enter the address/);
  } finally {
    await world.stop();
  }
});

test('a device added again gets every value again, and the widget is nudged', async () => {
  const world = await createWorld({ units: sigenStorSinglePhase() });
  try {
    const plant = world.device(PLANT_FR);
    const refreshes = world.fake.widgetRefreshes.length;
    const before = world.fake.states.length;
    await world.fake.deviceCreated(plant);
    assert.ok(world.fake.states.length - before >= plant.features.length - 3);
    assert.ok(world.fake.widgetRefreshes.length > refreshes);
  } finally {
    await world.stop();
  }
});
