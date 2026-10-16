// -----------------------------------------------------------------------------
// Registers every SDK handler on a GladysIntegration (or the SDK's fake
// Gladys) and returns the pieces, so index.js stays a few lines and the tests
// drive the very same wiring.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { ACTION_KEYS, testConnection } from './actions.js';
import { normalizeConfig } from './config.js';
import { setFeatureValue } from './control.js';
import { SigenergyHub } from './hub.js';
import { STATUS } from './messages.js';
import { createPoller } from './poller.js';
import { SCENE_ACTIONS } from './scenes.js';
import { Store } from './store.js';
import { WIDGET_KEY, energyFlowAction, energyFlowContent } from './widgets.js';

const logger = createLogger({ name: 'sigenergy-app' });

/**
 * @param {object} gladys GladysIntegration instance
 * @param {object} [options] test seams: store, createSocket, timers, now, timeoutMs
 */
export function registerHandlers(gladys, options = {}) {
  const refreshWidget = () => gladys.requestWidgetRefresh(WIDGET_KEY);
  const hub = new SigenergyHub({
    gladys,
    store: options.store ?? new Store(),
    createSocket: options.createSocket,
    now: options.now,
    timeoutMs: options.timeoutMs,
    // The mode, the alarms, the battery direction or the link changed.
    onChange: refreshWidget,
  });
  const poller = createPoller({
    gladys,
    hub,
    timers: options.timers ?? true,
    now: options.now,
    // A device just added: its tiles exist now, the open widgets re-pull.
    onDeviceRead: refreshWidget,
  });

  // Resolved once the first configuration is applied: a command arriving
  // during the first probe waits for it instead of finding no device.
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  const whenReady =
    (fn) =>
    async (...args) => {
      await ready;
      return fn(...args);
    };

  gladys.on('connected', async () => {
    try {
      await hub.configure(normalizeConfig(await gladys.getConfig()));
      await poller.restart();
      refreshWidget();
    } catch (err) {
      logger.error('Initialization failed', err);
      await gladys.setConnectionStatus(false, STATUS.initFailed).catch(() => {});
    } finally {
      resolveReady();
    }
  });

  gladys.on('disconnected', () => {
    poller.stop();
  });

  gladys.onConfigUpdated(
    whenReady(async (newConfig) => {
      logger.info('Configuration updated');
      poller.stop();
      await hub.configure(normalizeConfig(newConfig));
      await poller.restart();
      refreshWidget();
    }),
  );

  gladys.onScanRequest(whenReady(() => hub.rescan()));

  gladys.onSetValue(
    whenReady(async (device, feature, value) => {
      const runtime = hub.runtimeOf(device.external_id);
      const definition = runtime?.features.find(
        (candidate) => runtime.ids.feature(candidate.key) === feature.external_id,
      );
      if (!definition?.writable) {
        throw hub.controlError('unavailable');
      }
      await setFeatureValue(hub, definition.key, value);
    }),
  );

  // onPoll (fallback), onDeviceCreated, onDeviceUpdated.
  poller.register();

  gladys.onAction(
    ACTION_KEYS.TEST_CONNECTION,
    whenReady(() => testConnection(hub, { createSocket: options.createSocket })),
  );

  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(
      key,
      whenReady((fields) => handler(hub, fields ?? {})),
    );
  }

  gladys.onWidgetGet(
    WIDGET_KEY,
    whenReady(async (request) => energyFlowContent(hub, request)),
  );
  gladys.onWidgetAction(
    WIDGET_KEY,
    whenReady((actionKey, params) => energyFlowAction(hub, actionKey, params)),
  );

  return {
    hub,
    poller,
    ready,
    async stop() {
      poller.stop();
      hub.stop();
      await hub.store.flush?.();
    },
  };
}
