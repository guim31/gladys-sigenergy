// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// fixtures: a single-phase SigenStor with battery on a recent firmware, two
// three-phase hybrid inverters without battery on an older firmware, in every
// feature-name language, with battery control off and on.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createWorld } from './helpers/world.js';
import { hybridThreePhasePair, sigenStorSinglePhase } from './fixtures/sigenergy.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const systems = {
  sigenStor: { units: sigenStorSinglePhase, ids: '1', devices: 2 },
  hybridPair: { units: hybridThreePhasePair, ids: '1, 2', devices: 3 },
};

const scenarios = [];
for (const [system, spec] of Object.entries(systems)) {
  for (const language of ['en', 'fr', 'de', 'es']) {
    for (const control of [false, true]) {
      scenarios.push({ system, spec, language, control });
    }
  }
}

for (const { system, spec, language, control } of scenarios) {
  test(`every discovered device follows the Gladys rules (${system}, ${language}, control ${control ? 'on' : 'off'})`, async () => {
    const world = await createWorld({
      units: spec.units(),
      config: () => ({ language, allow_control: control, inverter_unit_ids: spec.ids }),
    });
    try {
      await world.app.poller.cycle({ force: true });
      const devices = world.fake.discoveredDevices;
      assert.equal(devices.length, spec.devices, 'the plant and every inverter are discovered');
      const deviceIds = new Set();

      for (const device of devices) {
        const where = device.name;
        assert.ok(!deviceIds.has(device.external_id), `${where}: duplicate device external_id`);
        deviceIds.add(device.external_id);

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
            const allowed = table.units_by_category[feature.category];
            if (allowed) {
              assert.ok(
                allowed.includes(feature.unit),
                `${at}: ${feature.unit} for ${feature.category}`,
              );
            }
          }

          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(feature.external_id.startsWith(`${device.external_id}:`), `${at}: foreign id`);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);
          assert.ok(feature.name.length <= 40, `${at}: name longer than 40 characters`);
          // A signed power needs symmetric bounds (the gauge needle).
          if (feature.min < 0 && feature.unit === 'watt') {
            assert.equal(feature.min, -feature.max, `${at}: asymmetric signed bounds`);
          }
        }
      }
    } finally {
      await world.stop();
    }
  });
}

test('the only writable features are the three battery selects, and only with control on', async () => {
  for (const control of [false, true]) {
    const world = await createWorld({
      units: sigenStorSinglePhase(),
      config: () => ({ allow_control: control }),
    });
    try {
      const writable = world.fake.discoveredDevices
        .flatMap((device) => device.features)
        .filter((feature) => !feature.read_only);
      assert.deepEqual(
        writable.map((feature) => feature.external_id.split(':').pop()).sort(),
        control ? ['charge_limit', 'control_mode', 'discharge_limit'] : [],
      );
      for (const feature of writable) {
        // Never a switch or a thermostat: voice assistants expose those.
        assert.equal(`${feature.category}/${feature.type}`, 'text/select');
        assert.ok(feature.supported_options.length > 1);
      }
    } finally {
      await world.stop();
    }
  }
});

test('energy tracking: only the home consumption is a consumption index', async () => {
  const world = await createWorld({ units: sigenStorSinglePhase() });
  try {
    const features = world.fake.discoveredDevices.flatMap((device) => device.features);
    const consumption = features.filter(
      (feature) =>
        (feature.category === 'energy-sensor' && ['index', 'energy'].includes(feature.type)) ||
        (feature.category === 'switch' && feature.type === 'energy'),
    );
    assert.deepEqual(
      consumption.map((feature) => feature.external_id.split(':').pop()),
      ['house_index'],
    );
    const production = features.filter(
      (feature) => feature.category === 'energy-production-sensor' && feature.type === 'index',
    );
    assert.deepEqual(
      production.map((feature) => feature.external_id.split(':').pop()),
      ['pv_index'],
    );
  } finally {
    await world.stop();
  }
});
