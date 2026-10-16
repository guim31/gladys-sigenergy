// -----------------------------------------------------------------------------
// The battery commands: off by default and refused then, the documented
// holding registers only, the rated power as the bound, the state read back.
// Through the three ways in: the device selects, the scene actions, the
// widget buttons.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLANT_EN, createWorld } from './helpers/world.js';
import { hybridThreePhasePair, sigenStorSinglePhase } from './fixtures/sigenergy.js';

const WRITABLE = new Set([40029, 40031, 40032, 40033, 40034, 40035]);

function controlWorld(control = true, extra = {}) {
  return createWorld({
    units: sigenStorSinglePhase(),
    config: () => ({ language: 'en', allow_control: control, ...extra }),
  });
}

const holding = (world, address) => world.server.units[247].holding.get(address);

function assertOnlyDocumentedWrites(world) {
  for (const write of world.server.writes) {
    assert.equal(write.unitId, 247, 'only the plant is written');
    for (let i = 0; i < write.values.length; i += 1) {
      assert.ok(WRITABLE.has(write.address + i), `register ${write.address + i} written`);
    }
  }
}

test('control is off by default: no control feature, every command refused, nothing written', async () => {
  const world = await createWorld({
    units: sigenStorSinglePhase(),
    config: () => ({ language: 'en' }),
  });
  try {
    const keys = world.device(PLANT_EN).features.map((f) => f.external_id.split(':').pop());
    assert.ok(!keys.includes('control_mode'));
    const scene = await world.fake.sceneAction('set_battery_mode', { mode: 'charge_grid' });
    assert.equal(scene.success, false);
    assert.match(scene.error, /Battery control is off/);
    const limits = await world.fake.sceneAction('set_battery_limits', { charge_limit_w: 1000 });
    assert.equal(limits.success, false);
    const widget = await world.fake.widgetAction(
      'energy_flow',
      'mode_charge',
      { mode: 'charge_grid' },
      {},
    );
    assert.equal(widget.success, false);
    assert.deepEqual(world.server.writes, []);
  } finally {
    await world.stop();
  }
});

test('the mode select: forced charge turns remote EMS on, then sets its mode; auto turns it off', async () => {
  const world = await controlWorld();
  try {
    const plant = world.device(PLANT_EN);
    const feature = world.feature(PLANT_EN, 'control_mode');
    assert.equal(world.state(PLANT_EN, 'control_mode'), 'auto');
    assert.deepEqual(
      feature.supported_options.map((option) => option.value),
      [
        'auto',
        'self_consumption',
        'charge_grid',
        'charge_pv',
        'discharge_pv',
        'discharge_ess',
        'standby',
      ],
    );

    const ack = await world.fake.setValue(plant, feature, 'charge_grid');
    assert.equal(ack.success, true, ack.error);
    assert.deepEqual(
      world.server.writes.map((write) => [write.address, write.values]),
      [
        [40029, [1]],
        [40031, [3]],
      ],
    );
    assert.equal(world.state(PLANT_EN, 'control_mode'), 'charge_grid', 'read back');

    await world.fake.setValue(plant, feature, 'auto');
    assert.equal(holding(world, 40029), 0);
    assert.equal(world.state(PLANT_EN, 'control_mode'), 'auto');

    const bad = await world.fake.setValue(plant, feature, 'explode');
    assert.equal(bad.success, false);
    assertOnlyDocumentedWrites(world);
  } finally {
    await world.stop();
  }
});

test('the limit selects: a step of the rated power, written in watts', async () => {
  const world = await controlWorld();
  try {
    const plant = world.device(PLANT_EN);
    const charge = world.feature(PLANT_EN, 'charge_limit');
    assert.equal(world.state(PLANT_EN, 'charge_limit'), '100');
    assert.equal(charge.supported_options[5].label, '3 kW (50%)');
    const ack = await world.fake.setValue(plant, charge, '50');
    assert.equal(ack.success, true, ack.error);
    assert.deepEqual(world.server.writes.at(-1), {
      unitId: 247,
      table: 'holding',
      address: 40032,
      values: [0, 3000],
    });
    assert.equal(world.state(PLANT_EN, 'charge_limit'), '50');
    const wrong = await world.fake.setValue(plant, charge, '55');
    assert.equal(wrong.success, false);
    assertOnlyDocumentedWrites(world);
  } finally {
    await world.stop();
  }
});

test('the scene actions: mode and limits, bounded by the rated power', async () => {
  const world = await controlWorld();
  try {
    const mode = await world.fake.sceneAction('set_battery_mode', { mode: 'discharge_ess' });
    assert.equal(mode.success, true, mode.error);
    assert.deepEqual(mode.data.outputs, { mode: 'discharge_ess' });
    assert.equal(holding(world, 40029), 1);
    assert.equal(holding(world, 40031), 6);

    const limits = await world.fake.sceneAction('set_battery_limits', {
      charge_limit_w: 2500,
      discharge_limit_w: 4000,
    });
    assert.equal(limits.success, true, limits.error);
    assert.deepEqual(limits.data.outputs, { charge_limit_w: 2500, discharge_limit_w: 4000 });
    assert.equal(holding(world, 40033), 2500);
    assert.equal(holding(world, 40035), 4000);

    const only = await world.fake.sceneAction('set_battery_limits', { discharge_limit_w: 0 });
    assert.deepEqual(only.data.outputs, { discharge_limit_w: 0 });
    assert.equal(holding(world, 40033), 2500, 'the charge limit is unchanged');

    const tooMuch = await world.fake.sceneAction('set_battery_limits', { charge_limit_w: 9000 });
    assert.equal(tooMuch.success, false);
    assert.match(tooMuch.error, /from 0 to 6000 W/);
    const nothing = await world.fake.sceneAction('set_battery_limits', {});
    assert.equal(nothing.success, false);
    assertOnlyDocumentedWrites(world);
  } finally {
    await world.stop();
  }
});

test('the widget buttons switch the mode, with a toast in every language', async () => {
  const world = await controlWorld();
  try {
    const ack = await world.fake.widgetAction(
      'energy_flow',
      'mode_charge',
      { mode: 'charge_grid' },
      {},
    );
    assert.equal(ack.success, true, ack.error);
    assert.equal(holding(world, 40031), 3);
    const message = ack.data.message ?? ack.data;
    assert.equal(message.en, 'Battery mode: Forced charge (grid first).');
    assert.equal(message.fr, 'Mode de la batterie : Charge forcée (réseau d’abord).');
    for (const text of Object.values(message)) {
      assert.ok(text.length <= 200);
    }
  } finally {
    await world.stop();
  }
});

test('a write the system refuses is reported, in the language of the configuration', async () => {
  const world = await controlWorld(true, { language: 'fr' });
  try {
    world.server.behaviour.nextException = 4;
    const ack = await world.fake.sceneAction('set_battery_mode', { mode: 'standby' });
    assert.equal(ack.success, false);
    assert.match(ack.error, /L’installation Sigenergy a refusé la commande/);
  } finally {
    await world.stop();
  }
});

test('no battery: no control feature even when allowed, and the commands say why', async () => {
  const world = await createWorld({
    units: hybridThreePhasePair(),
    config: () => ({ language: 'en', allow_control: true, inverter_unit_ids: '1,2' }),
  });
  try {
    const keys = world.device(PLANT_EN).features.map((f) => f.external_id.split(':').pop());
    assert.ok(!keys.includes('control_mode'));
    const ack = await world.fake.sceneAction('set_battery_mode', { mode: 'auto' });
    assert.match(ack.error, /No controllable battery/);
    assert.match(world.fake.connectionStatus.message.en, /no battery was found/);
    assert.deepEqual(world.server.writes, []);
  } finally {
    await world.stop();
  }
});
