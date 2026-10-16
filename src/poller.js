// -----------------------------------------------------------------------------
// The container's own polling timer.
//
// The devices are published with `should_poll: true` and a valid
// `poll_frequency`, but the core cannot be trusted to call onPoll: Gladys
// 5.2.0 skips devices created without `should_poll`, and a device keeps the
// polling fields it was created with, even once the core is fixed
// (GladysAssistant/Gladys#3198, not fixed in 5.2.1). So the container reads
// the system by itself, at the configured pace (10 s to 5 min), and the
// core's onPoll stays as a fallback.
//
// No double work: one cycle reads the whole system (plant and inverters, one
// request at a time on one connection); the timer skips a cycle when the last
// one started less than half a period ago, and the core's onPoll one started
// less than 90 % of a period ago.
//
// Only the devices the user added to Gladys are read (`gladys.devices`): the
// core drops the states of a device it does not know.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'sigenergy-poller' });

/**
 * @param {object} options
 * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
 * @param {import('./hub.js').SigenergyHub} options.hub
 * @param {boolean} [options.timers] run the periodic timer (tests may turn it off)
 * @param {() => void} [options.onDeviceRead] called after a device just added was read
 * @param {() => number} [options.now]
 */
export function createPoller({ gladys, hub, timers = true, onDeviceRead, now = () => Date.now() }) {
  let lastCycleAt;
  let inFlight = null;
  let timer = null;
  let stopped = false;

  const periodMs = () => hub.effectiveIntervalMs();

  async function cycle({ force = false, minGap = 0.5 } = {}) {
    if (inFlight) {
      await inFlight;
      if (!force) {
        return;
      }
    }
    if (gladys.connected === false) {
      logger.debug('Gladys unreachable: cycle skipped');
      return;
    }
    if (!force && lastCycleAt !== undefined && now() - lastCycleAt < periodMs() * minGap) {
      logger.debug(`Read ${now() - lastCycleAt} ms ago, skipped`);
      return;
    }
    lastCycleAt = now();
    inFlight = hub.poll().catch((err) => {
      logger.error(`Read cycle failed (${err.message})`);
    });
    try {
      await inFlight;
    } finally {
      inFlight = null;
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = null;
    if (!timers || stopped) {
      return;
    }
    timer = setTimeout(async () => {
      timer = null;
      try {
        await cycle();
      } finally {
        schedule();
      }
    }, periodMs());
  }

  const api = {
    /** Register the core's onPoll (fallback) and the reads of a device just added. */
    register() {
      gladys.onPoll((device) => api.pollFromCore(device));
      gladys.onDeviceCreated((device) => api.pollDevice(device));
      gladys.onDeviceUpdated((device) => api.pollDevice(device));
    },

    /** (Re)start: a new configuration, a (re)connection. Reads the system now. */
    async restart() {
      stopped = false;
      lastCycleAt = undefined;
      schedule();
      await cycle({ force: true });
    },

    /** One cycle now, as the timer runs it (tests). */
    cycle,

    /** The core's onPoll: reads the system unless the timer just did. */
    async pollFromCore(device) {
      if (!hub.runtimeOf(device.external_id)) {
        logger.debug(`onPoll ignored for ${device.external_id}`);
        return;
      }
      await cycle({ minGap: 0.9 });
    },

    /**
     * A device was just added (or updated) in Gladys: the SDK forgot what it
     * had published for it, every value is sent again now.
     */
    async pollDevice(device) {
      if (!hub.runtimeOf(device.external_id)) {
        return;
      }
      await cycle({ force: true });
      onDeviceRead?.(device);
    },

    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = null;
    },
  };
  return api;
}
