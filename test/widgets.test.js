// -----------------------------------------------------------------------------
// The "Sigenergy energy" widget: rendered exactly as sent (vocabulary and
// budget of the core, validateWidgetContent), its live tiles bound to
// features the devices really have, its buttons only with control on.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { PLANT_FR, createWorld } from './helpers/world.js';
import { hybridThreePhasePair, sigenStorSinglePhase } from './fixtures/sigenergy.js';

async function content(world, language = 'fr') {
  const ack = await world.fake.widgetGet('energy_flow', {
    settings: {},
    language,
    units: 'metric',
  });
  assert.equal(ack.success, true, ack.error);
  return ack.data.content ?? ack.data;
}

function boundFeatures(world, widget) {
  const ids = new Set(
    world.fake.discoveredDevices.flatMap((device) => device.features.map((f) => f.external_id)),
  );
  for (const component of widget.components.filter((c) => c.device_feature)) {
    assert.ok(ids.has(component.device_feature), `${component.device_feature} does not exist`);
  }
}

for (const control of [false, true]) {
  test(`the widget fits the core budget and binds existing features (control ${control ? 'on' : 'off'})`, async () => {
    const world = await createWorld({
      units: sigenStorSinglePhase(),
      config: () => ({ allow_control: control }),
    });
    try {
      for (const language of ['en', 'fr', 'de', 'es']) {
        const widget = await content(world, language);
        assert.deepEqual(validateWidgetContent(widget), [], language);
        assert.ok(widget.components.length <= 8);
        boundFeatures(world, widget);
        const types = widget.components.map((component) => component.type);
        assert.deepEqual(types.slice(0, 5), ['value', 'value', 'value', 'gauge', 'status']);
        const buttons = widget.components.filter((component) => component.type === 'button');
        assert.equal(buttons.length, control ? 3 : 0);
        if (control) {
          const keys = buttons.map((button) => button.action.key);
          assert.equal(new Set(keys).size, keys.length, 'distinct action keys');
          assert.ok(buttons.every((button) => button.action.confirm === true));
          // The current mode (auto) is marked by its icon, never by the style.
          assert.equal(buttons[0].icon, 'check-circle');
          assert.ok(buttons.every((button) => button.style === 'secondary'));
        }
      }
      const status = (await content(world)).components.find((c) => c.type === 'status');
      assert.deepEqual(
        status.items.map((item) => item.value),
        ['En charge, 1,1 kW', 'Autoconsommation maximale', 'Aucune'],
      );
    } finally {
      await world.stop();
    }
  });
}

test('without battery: three tiles, no gauge, no button; the alarm shows', async () => {
  const world = await createWorld({
    units: hybridThreePhasePair(),
    config: () => ({ language: 'en', allow_control: true, inverter_unit_ids: '1, 2' }),
  });
  try {
    const widget = await content(world, 'en');
    assert.deepEqual(validateWidgetContent(widget), []);
    assert.deepEqual(
      widget.components.map((component) => component.type),
      ['value', 'value', 'value', 'status'],
    );
    const status = widget.components.at(-1);
    assert.equal(status.items.at(-1).value, 'Inverter: grid power outage');
    assert.equal(status.items.at(-1).color, 'danger');
  } finally {
    await world.stop();
  }
});

test('before the system is added to Gladys, the widget says what to do', async () => {
  const world = await createWorld({ units: sigenStorSinglePhase(), createAll: false });
  try {
    const widget = await content(world, 'fr');
    assert.deepEqual(validateWidgetContent(widget), []);
    assert.equal(widget.components[0].type, 'text');
    assert.match(widget.components[0].text.fr, /onglet Découverte/);
  } finally {
    await world.stop();
  }
});

test('a system that stops answering shows it in the widget', async () => {
  const world = await createWorld({ units: sigenStorSinglePhase() });
  try {
    world.server.behaviour.mute = true;
    // Lost after two failed reads in a row.
    await world.app.poller.cycle({ force: true });
    await world.app.poller.cycle({ force: true });
    const status = (await content(world)).components.find((c) => c.type === 'status');
    assert.equal(status.items.at(-1).value, 'Ne répond pas');
    assert.equal(world.device(PLANT_FR) !== undefined, true);
  } finally {
    await world.stop();
  }
});
