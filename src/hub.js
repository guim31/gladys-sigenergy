// -----------------------------------------------------------------------------
// The hub: the configured Sigenergy system, its connection, what its probe
// found, and what the last read gave. Everything the SDK handlers do goes
// through it.
//
// - The devices are published once the probe knows them (kept in /data, so a
//   system that does not answer at restart is still published the same).
// - A read cycle reads the devices the user added to Gladys, publishes the
//   values that changed (plus a heartbeat every 6 hours) and follows the
//   reachability of the system: one log line and one scene event when it
//   stops answering, one when it answers again.
// - A cumulative index is never published lower than before: a firmware that
//   transiently reads 0 would otherwise make Gladys count the whole index as
//   consumed (or produced) in 30 minutes.
// - The battery commands (src/control.js) write the documented holding
//   registers only, and only when control is allowed in the configuration.
// -----------------------------------------------------------------------------

import { createLogger, DEVICE_POLL_FREQUENCIES } from '@gladysassistant/integration-sdk';
import { pollIntervalMs, readTarget } from './config.js';
import { joinLines, localize, pick } from './i18n.js';
import { createIssueLog } from './issues.js';
import { CONTROL_ERRORS, PROBE_ERRORS, STATUS, configErrorText } from './messages.js';
import { ModbusConnection, isUnreachable } from './modbus/connection.js';
import { BlockReader } from './modbus/reader.js';
import {
  controllable,
  inverterFeatures,
  inverterRegister,
  plantFeatures,
  plantRegister,
} from './model.js';
import { DEVICE_NAMES, featureName } from './names.js';
import { LAYOUT_VERSION, ProbeError, READ_OPTIONS, probeInverter, probePlant } from './probe.js';
import { decode, point } from './sigenergy/registers.js';

const logger = createLogger({ name: 'sigenergy' });

export const DEVICE_TYPES = { PLANT: 'plant', INVERTER: 'inverter' };
export const HEARTBEAT_MS = 6 * 60 * 60 * 1000;
/** Failed cycles in a row before a system that answered is declared lost. */
export const UNREACHABLE_AFTER = 2;
/** The core accepts 300 states a minute: keep a margin for the heartbeats. */
export const STATE_BUDGET_PER_MINUTE = 240;
/** An inverter missing at the probe is looked for again this often. */
export const REPROBE_MS = 10 * 60 * 1000;
export const TIMEOUT_MS = 3000;
export const TRIGGERS = {
  ALARM: 'alarm_raised',
  UNREACHABLE: 'system_unreachable',
  REACHABLE: 'system_reachable',
};

/** A serial number as the stable part of an external id. */
export const platformKey = (serial) => String(serial).replace(/[^A-Za-z0-9_-]/g, '');

export class SigenergyHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store src/store.js
   * @param {Function} [options.createSocket] test seam for the connection
   * @param {() => number} [options.now]
   * @param {() => void} [options.onChange] the widget's data changed
   * @param {number} [options.timeoutMs] per Modbus request (tests shorten it)
   */
  constructor({
    gladys,
    store,
    createSocket,
    now = () => Date.now(),
    onChange,
    timeoutMs = TIMEOUT_MS,
  }) {
    this.timeoutMs = timeoutMs;
    this.gladys = gladys;
    this.store = store;
    this.createSocket = createSocket;
    this.now = now;
    this.onChange = onChange ?? (() => {});
    this.config = null;
    this.target = null;
    this.errors = [];
    this.connection = null;
    this.layouts = { plant: null, inverters: {} };
    this.plant = null;
    this.inverters = new Map();
    this.status = freshStatus();
    this.lastStatus = null;
    this.lastProbeAt = 0;
    this.slowedDown = false;
    this.issues = createIssueLog(logger);
  }

  get lang() {
    return this.config?.language ?? 'fr';
  }

  // --- Configuration -------------------------------------------------------------

  /** Apply a configuration: probe the system, publish its devices. */
  async configure(config) {
    this.connection?.close();
    this.connection = null;
    this.config = config;
    const { target, errors } = readTarget(config);
    const sameSystem =
      target &&
      this.target &&
      target.host === this.target.host &&
      target.port === this.target.port &&
      target.plantUnitId === this.target.plantUnitId;
    this.target = target;
    this.errors = errors;
    if (!sameSystem) {
      this.status = freshStatus();
    }
    for (const error of errors) {
      logger.warn(`Configuration mistake: ${configErrorText(error).en}`);
    }
    if (!target) {
      this.layouts = { plant: null, inverters: {} };
      this.buildRuntimes();
      logger.info('Configuration: no Sigenergy system to read yet');
      await this.publishDevices();
      await this.reportStatus({ force: true });
      return;
    }
    this.connection = new ModbusConnection({
      host: target.host,
      port: target.port,
      timeoutMs: this.timeoutMs,
      ...(this.createSocket ? { createSocket: this.createSocket } : {}),
      now: this.now,
    });
    this.layouts = await this.cachedLayouts();
    this.buildRuntimes();
    logger.info(
      `Configuration: Sigenergy system at ${target.host}:${target.port}, plant ${target.plantUnitId}, ` +
        `inverter(s) ${target.inverterUnitIds.join(', ')}, control ${config.allow_control ? 'allowed' : 'off'}`,
    );
    await this.probe();
    await this.publishDevices();
    await this.reportStatus({ force: true });
  }

  storeKey() {
    return this.target.host.toLowerCase();
  }

  async cachedLayouts() {
    try {
      const stored = await this.store.get(this.storeKey());
      if (stored?.plant?.version === LAYOUT_VERSION) {
        return { plant: stored.plant, inverters: stored.inverters ?? {} };
      }
    } catch {
      // A broken file: probed again.
    }
    return { plant: null, inverters: {} };
  }

  /** Read again what the system has (the "Scan" button of the Discovery tab). */
  async rescan() {
    if (this.target) {
      await this.probe({ force: true });
    }
    await this.publishDevices();
    await this.reportStatus();
  }

  /**
   * Probe the inverters missing from the layout (all with `force`), then the
   * plant. A failure keeps what /data had.
   * @returns {Promise<boolean>} whether the devices changed
   */
  async probe({ force = false } = {}) {
    if (!this.target) {
      return false;
    }
    this.lastProbeAt = this.now();
    const before = JSON.stringify(this.layouts);
    const { inverterUnitIds, plantUnitId } = this.target;
    try {
      for (const unitId of inverterUnitIds) {
        if (!force && this.layouts.inverters[unitId]) {
          continue;
        }
        try {
          this.layouts.inverters[unitId] = await probeInverter(this.connection, unitId);
          logger.info(`Inverter ${unitId}: ${describeInverter(this.layouts.inverters[unitId])}`);
        } catch (err) {
          // A wrong unit id may not answer at all, like a system that is off:
          // the plant tells them apart below.
          logger.debug(`Inverter ${unitId} not probed (${err.message})`);
        }
      }
      if (force || !this.layouts.plant) {
        const first = inverterUnitIds.map((id) => this.layouts.inverters[id]).find(Boolean);
        const platformId =
          this.layouts.plant?.platformId ?? (first ? platformKey(first.serial) : null);
        // Without an inverter the plant cannot be named, but whether it
        // answers says whether the address or the inverter ids are wrong.
        const plant = await probePlant(this.connection, plantUnitId, platformId);
        if (platformId) {
          plant.hasBattery =
            plant.hasBattery ||
            Object.values(this.layouts.inverters).some((inverter) => inverter.hasBattery);
          this.layouts.plant = plant;
        }
        this.markSuccess();
      }
    } catch (err) {
      this.markFailure(err);
    }
    const changed = JSON.stringify(this.layouts) !== before;
    if (changed) {
      await this.store.set(this.storeKey(), this.layouts);
      this.buildRuntimes();
      if (this.layouts.plant) {
        logger.info(`Plant: ${describePlant(this.layouts.plant)}`);
      }
    }
    return changed;
  }

  anyInverterKnown() {
    return this.target.inverterUnitIds.some((id) => this.layouts.inverters[id]);
  }

  /** The runtimes of the devices, from the layouts. */
  buildRuntimes() {
    const previous = { plant: this.plant, inverters: this.inverters };
    const control = Boolean(this.config?.allow_control);
    const plantLayout = this.target ? this.layouts.plant : null;
    this.plant = plantLayout
      ? {
          kind: DEVICE_TYPES.PLANT,
          unitId: this.target.plantUnitId,
          layout: plantLayout,
          ids: this.gladys.externalIds(DEVICE_TYPES.PLANT, plantLayout.platformId),
          features: plantFeatures(plantLayout, { control }),
          registerOf: plantRegister,
          reader: new BlockReader(),
          ...keep(previous.plant, plantLayout.platformId),
        }
      : null;
    this.inverters = new Map();
    if (!this.target || !plantLayout) {
      return;
    }
    for (const unitId of this.target.inverterUnitIds) {
      const layout = this.layouts.inverters[unitId];
      if (!layout) {
        continue;
      }
      const old = previous.inverters.get(unitId);
      this.inverters.set(unitId, {
        kind: DEVICE_TYPES.INVERTER,
        unitId,
        layout,
        ids: this.gladys.externalIds(DEVICE_TYPES.INVERTER, platformKey(layout.serial)),
        features: inverterFeatures(layout),
        registerOf: inverterRegister,
        reader: new BlockReader(),
        reachable: old?.layout.serial === layout.serial ? old.reachable : null,
        ...keep(old, layout.serial),
      });
    }
  }

  /** Every runtime: the plant first. */
  runtimes() {
    return this.plant ? [this.plant, ...this.inverters.values()] : [];
  }

  // --- Devices ------------------------------------------------------------------------

  buildDevices() {
    return this.runtimes().map((runtime) => this.buildDevice(runtime));
  }

  buildDevice(runtime) {
    const { layout, ids, kind } = runtime;
    const lang = this.lang;
    const single = this.inverters.size <= 1;
    const params = [{ name: 'UNIT_ID', value: String(runtime.unitId) }];
    let name;
    let model;
    if (kind === DEVICE_TYPES.PLANT) {
      name = pick(DEVICE_NAMES.plant, lang);
      model = 'Sigenergy';
    } else {
      model = layout.model || pick(DEVICE_NAMES.inverter, lang);
      name = `${model}${single ? '' : ` #${runtime.unitId}`}`;
      params.push({ name: 'SERIAL', value: layout.serial });
      if (layout.firmware) {
        params.push({ name: 'FIRMWARE', value: layout.firmware });
      }
    }
    return {
      name,
      external_id: ids.device,
      model,
      // Read by the container's own timer (src/poller.js); the core's poll is
      // a fallback, once a minute.
      should_poll: true,
      poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_MINUTES,
      params,
      features: runtime.features.map((feature) => {
        const published = {
          name: featureName(feature.name, lang, feature.n),
          external_id: ids.feature(feature.key),
          category: feature.category,
          type: feature.type,
          min: feature.min,
          max: feature.max,
          read_only: !feature.writable,
          has_feedback: Boolean(feature.writable),
          // A select keeps no history; texts change rarely and are worth keeping.
          keep_history: !feature.writable,
        };
        if (feature.unit) {
          published.unit = feature.unit;
        }
        if (feature.options) {
          published.supported_options = feature.options(lang);
        }
        return published;
      }),
    };
  }

  async publishDevices() {
    await this.gladys.publishDiscoveredDevices(this.buildDevices());
  }

  /** The runtime of a Gladys device, by its external id. */
  runtimeOf(externalId) {
    return this.runtimes().find((runtime) => runtime.ids.device === externalId);
  }

  /** The Gladys device of a runtime, when the user added it. */
  createdDevice(runtime) {
    return (this.gladys.devices ?? []).find((device) => device.external_id === runtime.ids.device);
  }

  /** The runtimes whose device the user added to Gladys. */
  createdRuntimes() {
    return this.runtimes().filter((runtime) => this.createdDevice(runtime));
  }

  // --- Reading ------------------------------------------------------------------------

  /**
   * One read cycle: the devices added to Gladys, plant first.
   * @returns {Promise<boolean>} whether the system answered
   */
  async poll() {
    if (!this.target) {
      return false;
    }
    if (!this.layouts.plant || this.missingInverters()) {
      const due = !this.layouts.plant || this.now() - this.lastProbeAt >= REPROBE_MS;
      if (due && (await this.probe())) {
        await this.publishDevices();
      }
      if (!this.layouts.plant) {
        await this.reportStatus();
        return false;
      }
    }
    const runtimes = this.createdRuntimes();
    let answered = false;
    for (const runtime of runtimes) {
      try {
        const registers = await this.read(runtime);
        answered = true;
        if (runtime.kind === DEVICE_TYPES.INVERTER) {
          this.markInverter(runtime, true);
        }
        await this.publishValues(runtime, registers);
      } catch (err) {
        if (!isUnreachable(err) && !(err instanceof ProbeError)) {
          logger.debug(`Unit ${runtime.unitId}: read failed (${err.message})`);
        }
        if (runtime.kind === DEVICE_TYPES.INVERTER) {
          this.markInverter(runtime, false);
        }
        if (runtime.kind === DEVICE_TYPES.PLANT || (isUnreachable(err) && !answered)) {
          this.markFailure(err);
          if (isUnreachable(err)) {
            break; // nothing answers: the other units would time out too
          }
        }
      }
    }
    if (answered) {
      this.markSuccess();
    }
    await this.reportStatus();
    return answered;
  }

  missingInverters() {
    return this.target.inverterUnitIds.some((id) => !this.layouts.inverters[id]);
  }

  /**
   * Read every register the features of a device need.
   * @returns {Promise<Record<string, unknown>>} decoded values by register name
   * @throws when the device does not answer, or refuses everything
   */
  async read(runtime) {
    const names = [...new Set(runtime.features.flatMap((feature) => feature.registers))];
    const points = names.map((name) => point(name, runtime.registerOf(name)));
    const results = await runtime.reader.readPoints(
      this.connection,
      runtime.unitId,
      points,
      READ_OPTIONS,
    );
    if (points.length > 0 && [...results.values()].every((result) => result instanceof Error)) {
      throw runtime.kind === DEVICE_TYPES.PLANT
        ? new ProbeError('plantRefused', { unitId: runtime.unitId })
        : new ProbeError('notInverter', { unitId: runtime.unitId });
    }
    const registers = {};
    for (const name of names) {
      const words = results.get(name);
      registers[name] = Array.isArray(words) ? decode(runtime.registerOf(name), words) : undefined;
    }
    runtime.registers = registers;
    runtime.lastReadAt = this.now();
    return registers;
  }

  async publishValues(runtime, registers) {
    const created = this.createdDevice(runtime);
    if (!created) {
      return;
    }
    // Only the features the device was created with: the core drops the others.
    const known = new Set((created.features ?? []).map((feature) => feature.external_id));
    const context = { lang: this.lang, layout: runtime.layout };
    const states = [];
    const values = new Map();
    for (const feature of runtime.features) {
      let value;
      try {
        value = feature.value(registers, context);
      } catch (err) {
        logger.debug(`${feature.key}: cannot compute (${err.message})`);
      }
      values.set(feature.key, value);
      const externalId = runtime.ids.feature(feature.key);
      if (value === undefined || (known.size > 0 && !known.has(externalId))) {
        continue;
      }
      if (feature.index && !this.acceptIndex(runtime, feature, value)) {
        continue;
      }
      if (typeof value === 'object') {
        states.push({ device_feature_external_id: externalId, text: value.text });
      } else {
        states.push({
          device_feature_external_id: externalId,
          state: roundTo(value, feature.precision ?? 0),
        });
      }
    }
    const before = widgetSignature(runtime);
    runtime.values = values;
    if (runtime.kind === DEVICE_TYPES.PLANT) {
      this.checkAlarms(runtime, registers, created);
    }
    if (widgetSignature(runtime) !== before) {
      this.onChange();
    }
    if (states.length === 0) {
      return;
    }
    try {
      const { count } = await this.gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
      logger.debug(`Unit ${runtime.unitId}: ${count} state(s) published`);
      this.issues.ok('publish', 'Gladys accepts the states again');
    } catch (err) {
      this.issues.fail('publish', `Publishing the states failed: ${err.message}`);
    }
  }

  /** An index that goes down, or reads 0, is a reading glitch: not published. */
  acceptIndex(runtime, feature, value) {
    runtime.lastIndex ??= new Map();
    const previous = runtime.lastIndex.get(feature.key);
    if (value <= 0 || (previous !== undefined && value < previous)) {
      logger.debug(`${feature.key}: ${value} kWh ignored (last ${previous ?? 'none'})`);
      return false;
    }
    runtime.lastIndex.set(feature.key, value);
    return true;
  }

  /** Fire `alarm_raised` for every alarm that was not active at the previous read. */
  checkAlarms(runtime, registers, created) {
    const feature = runtime.features.find((candidate) => candidate.key === 'alarms');
    if (!feature) {
      return;
    }
    const alarms = feature.alarmsOf(registers);
    const ids = new Set(alarms.map((alarm) => alarm.id));
    const previous = runtime.alarmIds;
    runtime.alarmIds = ids;
    runtime.alarms = alarms;
    if (!previous) {
      // First read: what is already active is not news (a restart).
      if (alarms.length > 0) {
        logger.warn(`Active alarm(s): ${alarms.map((alarm) => alarm.text.en).join('; ')}`);
      }
      return;
    }
    const raised = alarms.filter((alarm) => !previous.has(alarm.id));
    const cleared = [...previous].filter((id) => !ids.has(id));
    if (cleared.length > 0) {
      logger.info(`Alarm(s) cleared: ${cleared.join(', ')}`);
    }
    if (raised.length === 0) {
      return;
    }
    logger.warn(`Alarm raised: ${raised.map((alarm) => alarm.text.en).join('; ')}`);
    const lang = this.lang;
    this.fireTrigger(TRIGGERS.ALARM, created, {
      alarm: raised.map((alarm) => pick(alarm.text, lang)).join(' ; '),
      alarms: alarms.map((alarm) => pick(alarm.text, lang)).join(' ; '),
    });
  }

  markSuccess() {
    const { status } = this;
    const wasLost = status.reachable === false;
    status.failures = 0;
    status.error = null;
    status.lastReadAt = this.now();
    if (status.reachable === true) {
      return;
    }
    status.reachable = true;
    this.onChange();
    if (wasLost) {
      logger.info('The Sigenergy system answers again');
      const plant = this.plant && this.createdDevice(this.plant);
      if (plant) {
        this.fireTrigger(TRIGGERS.REACHABLE, plant, {});
      }
    } else {
      logger.info('The Sigenergy system answers');
    }
  }

  markFailure(err) {
    const { status } = this;
    status.failures += 1;
    status.error = errorText(err);
    const declare =
      status.reachable === null ||
      (status.reachable === true && status.failures >= UNREACHABLE_AFTER);
    if (!declare) {
      logger.debug(`${status.error.en} (failure ${status.failures})`);
      return;
    }
    const wasReachable = status.reachable === true;
    status.reachable = false;
    this.onChange();
    logger.warn(`The Sigenergy system does not answer: ${status.error.en}`);
    const plant = this.plant && this.createdDevice(this.plant);
    if (wasReachable && plant) {
      this.fireTrigger(TRIGGERS.UNREACHABLE, plant, { error: pick(status.error, this.lang) });
    }
  }

  markInverter(runtime, ok) {
    const key = `inverter-${runtime.unitId}`;
    if (ok) {
      runtime.reachable = true;
      this.issues.ok(key, `Inverter ${runtime.unitId} answers again`);
    } else {
      runtime.reachable = false;
      this.issues.fail(key, `Inverter ${runtime.unitId} does not answer`);
    }
  }

  fireTrigger(key, device, extra) {
    const data = { device: device.external_id, device_name: device.name ?? '', ...extra };
    for (const [name, value] of Object.entries(data)) {
      if (typeof value === 'string') {
        data[name] = value.slice(0, 1000);
      }
    }
    this.gladys.publishSceneEvent(key, data).catch((err) => {
      logger.warn(`Scene trigger ${key} refused: ${err.message}`);
    });
  }

  /** Delay between two reads: the configured one, slowed down to keep under the core's state budget. */
  effectiveIntervalMs() {
    const configured = pollIntervalMs(this.config ?? { poll_interval: '15' });
    const features = this.createdRuntimes().reduce(
      (total, runtime) => total + runtime.features.length,
      0,
    );
    const minimum = Math.ceil((features * 60_000) / STATE_BUDGET_PER_MINUTE);
    if (minimum > configured) {
      if (!this.slowedDown) {
        logger.warn(
          `${features} features every ${configured / 1000} s would exceed the ${STATE_BUDGET_PER_MINUTE} states a minute Gladys accepts: reading every ${Math.ceil(minimum / 1000)} s instead`,
        );
        this.slowedDown = true;
      }
      return Math.ceil(minimum / 1000) * 1000;
    }
    this.slowedDown = false;
    return configured;
  }

  // --- Status -------------------------------------------------------------------------

  /** Whether the battery commands are available. */
  controlState() {
    if (!this.config?.allow_control) {
      return 'off';
    }
    return this.layouts.plant && controllable(this.layouts.plant) ? 'on' : 'unavailable';
  }

  /** The connection status shown in the Configuration screen, sent when it changes. */
  async reportStatus({ force = false } = {}) {
    const lines = [];
    let connected = true;
    if (!this.target) {
      connected = false;
      if (this.errors.some((error) => error.code !== 'noHost')) {
        lines.push(STATUS.configErrors, ...this.errors.map(configErrorText));
      } else {
        lines.push(STATUS.notConfigured);
      }
    } else {
      if (this.errors.length > 0) {
        lines.push(STATUS.configErrors, ...this.errors.map(configErrorText));
      }
      if (this.status.reachable === false) {
        connected = false;
        lines.push(
          localize(
            {
              en: (error) => STATUS.notAnswering.en(error.en),
              fr: (error) => STATUS.notAnswering.fr(error.fr),
              de: (error) => STATUS.notAnswering.de(error.de),
              es: (error) => STATUS.notAnswering.es(error.es),
            },
            this.status.error ?? localize({ en: '?' }),
          ),
        );
      } else if (!this.layouts.plant) {
        connected = false;
        lines.push(localize(STATUS.noInverter, this.target.inverterUnitIds));
      } else {
        const missing = this.target.inverterUnitIds.filter((id) => !this.layouts.inverters[id]);
        if (missing.length > 0) {
          lines.push(localize(STATUS.noInverter, missing));
        }
        for (const runtime of this.inverters.values()) {
          if (runtime.reachable === false) {
            lines.push(localize(STATUS.inverterSilent, runtime.unitId));
          }
        }
        if (this.status.reachable === true) {
          lines.push(localize(STATUS.answering, this.inverters.size));
        }
      }
      const control = this.controlState();
      lines.push(
        control === 'on'
          ? STATUS.controlOn
          : control === 'off'
            ? STATUS.controlOff
            : STATUS.controlUnavailable,
      );
    }
    const message = joinLines(lines);
    const key = JSON.stringify([connected, message]);
    if (!force && key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    try {
      await this.gladys.setConnectionStatus(connected, message);
    } catch (err) {
      logger.debug(`Connection status not sent: ${err.message}`);
      this.lastStatus = null;
    }
  }

  // --- Writing ------------------------------------------------------------------------

  /** Write registers of the plant (control.js checks what and whether). */
  async writePlant(register, words) {
    await this.connection.writeRegisters(this.plant.unitId, register.address, words);
  }

  /** A control error, in the language of the configuration (a thrown error has one text). */
  controlError(code, ...args) {
    const template = CONTROL_ERRORS[code][this.lang] ?? CONTROL_ERRORS[code].en;
    return new Error(typeof template === 'function' ? template(...args) : template);
  }

  // --- Lifecycle ------------------------------------------------------------------------

  stop() {
    this.connection?.close();
    this.connection = null;
  }
}

function freshStatus() {
  return { reachable: null, failures: 0, lastReadAt: null, error: null };
}

/** What survives a rebuild of a runtime of the same physical device. */
function keep(old, identity) {
  if (!old || (old.layout.platformId ?? old.layout.serial) !== identity) {
    return {};
  }
  return {
    values: old.values,
    registers: old.registers,
    lastIndex: old.lastIndex,
    alarmIds: old.alarmIds,
    alarms: old.alarms,
    lastReadAt: old.lastReadAt,
  };
}

/** What the widget shows of a runtime, to nudge it only on a change. */
function widgetSignature(runtime) {
  const values = runtime.values ?? new Map();
  return JSON.stringify(
    ['ems_mode', 'alarms', 'control_mode', 'battery_charge_power', 'battery_discharge_power'].map(
      (key) => {
        const value = values.get(key);
        // Powers move all the time: the widget only cares about their direction.
        return typeof value === 'number' ? value > 0 : value;
      },
    ),
  );
}

/** Why the system does not answer, in the four languages. */
export function errorText(err) {
  if (err instanceof ProbeError && PROBE_ERRORS[err.code]) {
    return localize(PROBE_ERRORS[err.code], err.params);
  }
  return localize({ en: err?.message ?? String(err) });
}

export function roundTo(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function describeInverter(layout) {
  return [
    layout.model || 'unknown model',
    `firmware ${layout.firmware || '?'}`,
    `${layout.phases} phase(s)`,
    `${layout.pvStrings} PV string(s)`,
    layout.hasBattery ? 'battery' : 'no battery',
  ].join(', ');
}

function describePlant(layout) {
  return [
    layout.hasBattery ? `battery ${layout.essCapacityKwh} kWh` : 'no battery',
    `home power from ${layout.houseSource}`,
    `${layout.supported.length} registers`,
  ].join(', ');
}
