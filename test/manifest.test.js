// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../src/app.js';
import { DEFAULT_CONFIG, POLL_INTERVALS } from '../src/config.js';
import { TRIGGERS } from '../src/hub.js';
import { LANGUAGES } from '../src/i18n.js';
import { CONTROL_MODE_KEYS } from '../src/sigenergy/enums.js';
import { MemoryStore } from '../src/store.js';
import { WIDGET_KEY } from '../src/widgets.js';
import { SCENE_ACTIONS } from '../src/scenes.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

// The handlers the integration actually registers on the SDK.
const registered = createFakeGladys();
const app = registerHandlers(registered, { store: new MemoryStore(), timers: false });
await app.stop();
const handlerKeys = (prefix) =>
  Object.keys(registered.handlers)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length));

const keysOf = (list) => (list ?? []).map((entry) => entry.key);
const field = (key) => manifest.config_schema.find((entry) => entry.key === key);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('the identity of the integration', () => {
  assert.equal(manifest.name, 'Sigenergy');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  assert.equal(manifest.type, 'device');
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.categories, ['energy']);
  assert.equal(manifest.docker_image, `ghcr.io/guim31/gladys-sigenergy:${manifest.version}`);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-sigenergy/main/cover.png',
  );
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

test('widgets, scene triggers and actions require Gladys >= 5.1.0', () => {
  assert.ok(isAtLeast(minGladysVersion(), [5, 1, 0]), manifest.gladys_version);
  // No widget button opens a form (that would need 5.2.0, #3168).
  assert.ok(!JSON.stringify(manifest.widgets).includes('"fields"'));
});

test('every action of the manifest has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.actions).sort(), handlerKeys('action:').sort());
});

test('every widget has its handlers, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.widgets), [WIDGET_KEY]);
  assert.deepEqual(handlerKeys('widget:'), [WIDGET_KEY]);
  assert.deepEqual(handlerKeys('widgetAction:'), [WIDGET_KEY]);
  assert.ok(manifest.widgets[0].action_timeout_seconds >= 10);
});

test('the scene triggers the code fires are the declared ones', () => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(TRIGGERS).sort());
  for (const trigger of manifest.scene_triggers) {
    // The filter field matches the `device` key of the event data.
    assert.deepEqual(keysOf(trigger.fields), ['device']);
    assert.ok(keysOf(trigger.variables).includes('device_name'));
  }
});

test('every scene action has a handler, and its mode options are the code modes', () => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
  assert.deepEqual(handlerKeys('sceneAction:').sort(), Object.keys(SCENE_ACTIONS).sort());
  const setMode = manifest.scene_actions.find((action) => action.key === 'set_battery_mode');
  assert.deepEqual(
    setMode.fields[0].options.map((option) => option.value),
    CONTROL_MODE_KEYS,
  );
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const entry of manifest.config_schema) {
    if (entry.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[entry.key], entry.default, `DEFAULT_CONFIG.${entry.key}`);
    }
  }
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    assert.ok(field(key), `DEFAULT_CONFIG.${key} is not in the manifest`);
  }
});

test('the select options are the values the code knows', () => {
  const values = (key) => field(key).options.map((option) => option.value);
  assert.deepEqual(values('language'), LANGUAGES);
  assert.deepEqual(values('poll_interval'), POLL_INTERVALS);
});

test('number fields: integer bounds and defaults (the form renders them without a step)', () => {
  for (const entry of allFields.filter((candidate) => candidate.type === 'number')) {
    for (const key of ['min', 'max', 'default']) {
      if (entry[key] !== undefined) {
        assert.ok(Number.isInteger(entry[key]), `${entry.key}.${key}`);
      }
    }
  }
});

test('control is off by default, and nothing secret is asked', () => {
  assert.equal(field('allow_control').default, false);
  assert.equal(DEFAULT_CONFIG.allow_control, false);
  assert.ok(!allFields.some((entry) => entry.type === 'secret'));
});

test('an action field never relies on a default (the core applies none to actions)', () => {
  for (const action of manifest.actions) {
    for (const entry of action.fields ?? []) {
      assert.ok(entry.default === undefined || !entry.required, `${action.key}.${entry.key}`);
    }
  }
});

test('the catalog description holds 10 to 100 characters in every language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});

test('every placeholder is a multi-language object', () => {
  for (const entry of allFields.filter((candidate) => candidate.placeholder !== undefined)) {
    assert.equal(typeof entry.placeholder, 'object', entry.key);
    assert.ok(entry.placeholder.en, entry.key);
  }
});
