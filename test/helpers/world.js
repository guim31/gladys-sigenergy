// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake Sigenergy system on
// 127.0.0.1, an in-memory /data, and the integration wired on top through
// registerHandlers — the very wiring index.js uses.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { MemoryStore } from '../../src/store.js';
import { createFakeModbusServer } from './fakeModbus.js';

// Keep the test output readable (LOG_LEVEL is read on every log call).
// LOG_LEVEL=debug npm test shows them.
process.env.LOG_LEVEL ??= 'silent';

/**
 * @param {object} options
 * @param {object} [options.units] the register maps by unit id (null: no server)
 * @param {object} [options.server] more options of the fake server (silentUnits...)
 * @param {(server) => object} [options.config] the integration config
 * @param {boolean} [options.connect]
 * @param {boolean} [options.createAll] add every discovered device to Gladys
 * @param {object} [options.store]
 * @param {boolean} [options.timers] run the container's polling timer
 * @param {() => number} [options.now]
 */
export async function createWorld({
  units,
  server: serverOptions = {},
  config = () => ({}),
  connect = true,
  createAll = true,
  store = new MemoryStore(),
  timers = false,
  now,
  timeoutMs = 300,
} = {}) {
  const server = units ? await createFakeModbusServer({ units, ...serverOptions }) : null;
  const gladys = createFakeGladys({
    config: {
      ...(server ? { host: server.host, port: server.port } : {}),
      ...config(server),
    },
  });
  const app = registerHandlers(gladys, { store, timers, now, timeoutMs });
  const world = {
    gladys,
    fake: gladys.fake,
    app,
    hub: app.hub,
    server,
    store,
    /** Add the discovered devices to Gladys, as the user does from the Discovery tab. */
    async createDevices(devices = gladys.fake.discoveredDevices) {
      for (const device of devices) {
        await gladys.fake.deviceCreated(device);
      }
    },
    device(name) {
      return gladys.fake.discoveredDevices.find((device) => device.name === name);
    },
    feature(deviceName, key) {
      const device = world.device(deviceName);
      return device?.features.find((feature) => feature.external_id.endsWith(`:${key}`));
    },
    /** The last state published for a feature, by device name and feature key. */
    state(deviceName, key) {
      const feature = world.feature(deviceName, key);
      if (!feature) {
        throw new Error(`No feature ${key} on ${deviceName}`);
      }
      return gladys.fake.lastState(feature.external_id);
    },
    async stop() {
      await app.stop();
      await server?.close();
    },
  };
  if (connect) {
    await gladys.connect();
    if (createAll) {
      await world.createDevices();
    }
  }
  return world;
}

/**
 * Capture the log lines written at `level` and above while `run` runs.
 * @returns {Promise<string[]>}
 */
export async function captureLogs(t, run, level = 'info') {
  const lines = [];
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const record = (...args) => lines.push(args.map(String).join(' '));
  t.mock.method(console, 'log', record);
  t.mock.method(console, 'error', record);
  try {
    await run();
  } finally {
    process.env.LOG_LEVEL = previous;
    console.log.mock.restore();
    console.error.mock.restore();
  }
  return lines;
}

export const PLANT_FR = 'Installation Sigenergy';
export const PLANT_EN = 'Sigenergy system';
