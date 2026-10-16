// -----------------------------------------------------------------------------
// The Gladys devices of a Sigenergy system and their features.
//
// - The plant (unit 247) is the system as a whole: solar, home, grid,
//   battery, the cumulative indexes of energy tracking, the operating mode and
//   the alarms; and, when control is allowed in the configuration, the
//   battery control mode and the charge and discharge limits.
// - Each hybrid inverter (its own unit id) gets its own device: its power,
//   its battery, phase voltages and currents, PV strings, temperatures and
//   state.
//
// What a device gets depends on what its probe found (src/probe.js): no
// battery, no battery features; registers the firmware refuses, no feature.
// Feature keys are forever (they make the external ids): never rename one.
//
// Energy tracking (Gladys 5.2): the core derives the 30-minute consumption and
// its cost from every `energy-sensor/index`, and attaches it to the main
// electricity meter. So only the home consumption is published in that
// category; the grid and battery indexes use their own categories, which the
// core does not count as consumers, and the solar index is a production index.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { pick } from './i18n.js';
import {
  CONTROL_MODES,
  CONTROL_MODE_KEYS,
  EMS_WORK_MODES,
  RUNNING_STATES,
  activeAlarms,
  controlModeOf,
  enumText,
} from './sigenergy/enums.js';
import {
  INVERTER,
  PLANT,
  PLANT_SETTINGS,
  THREE_PHASE_OUTPUTS,
  pvStringRegisters,
} from './sigenergy/registers.js';

/** The limit options, in percent of the rated battery power. */
export const LIMIT_STEPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

/** Large enough for any cumulative index (kWh). */
const INDEX_MAX = 1_000_000_000;

const watts = (kw) => (kw === undefined ? undefined : Math.round(kw * 1000));
const positive = (value) => (value === undefined ? undefined : Math.max(0, value));
const negativePart = (value) => (value === undefined ? undefined : Math.max(0, -value));

const PLANT_ALARMS = [
  ['pcs1', 'alarm1'],
  ['pcs2', 'alarm2'],
  ['ess', 'alarm3'],
  ['gateway', 'alarm4'],
  ['dcCharger', 'alarm5'],
  ['plant1', 'alarm6'],
  ['plant2', 'alarm7'],
];
const INVERTER_ALARMS = [
  ['pcs1', 'alarm1'],
  ['pcs2', 'alarm2'],
  ['ess', 'alarm3'],
  ['gateway', 'alarm4'],
  ['dcCharger', 'alarm5'],
];

const number = (key, category, type, unit, min, max, registers, value, extra = {}) => ({
  key,
  name: key,
  category,
  type,
  unit,
  min,
  max,
  registers,
  value,
  ...extra,
});

const text = (key, registers, value, extra = {}) => ({
  key,
  name: key,
  category: C.TEXT,
  type: T.TEXT.TEXT,
  min: 0,
  max: 0,
  text: true,
  registers,
  value,
  ...extra,
});

const binary = (key, registers, value) => ({
  key,
  name: key,
  category: C.INPUT,
  type: T.INPUT.BINARY,
  min: 0,
  max: 1,
  registers,
  value,
});

/** The alarm features (a 0/1 input and the list), from a list of [table, register]. */
function alarmFeatures(list, registers, supported) {
  const present = list.filter(([, name]) => supported(name));
  if (present.length === 0) {
    return [];
  }
  const names = present.map(([, name]) => name);
  const alarmsOf = (r) =>
    activeAlarms(
      present.map(([table, name]) => ({
        table,
        address: registers[name].address,
        value: r[name],
      })),
    );
  const known = (r) => names.some((name) => r[name] !== undefined);
  return [
    binary('alarm', names, (r) => (known(r) ? (alarmsOf(r).length > 0 ? 1 : 0) : undefined)),
    text(
      'alarms',
      names,
      (r, { lang }) => (known(r) ? { text: alarmList(alarmsOf(r), lang) } : undefined),
      { alarmsOf },
    ),
  ];
}

export const NO_ALARM = { en: 'None', fr: 'Aucune', de: 'Keine', es: 'Ninguna' };

/** The alarms, joined, never empty (Gladys ignores an empty text). */
export function alarmList(alarms, lang) {
  if (alarms.length === 0) {
    return pick(NO_ALARM, lang);
  }
  const joined = alarms.map((alarm) => pick(alarm.text, lang)).join(' ; ');
  return joined.length <= 250 ? joined : `${joined.slice(0, 249)}…`;
}

/**
 * The features of the plant device.
 * @param {object} layout what the probe found (src/probe.js)
 * @param {{ control: boolean }} options control allowed in the configuration
 */
export function plantFeatures(layout, { control = false } = {}) {
  const supported = (name) => layout.supported.includes(name);
  const power = layout.powerBoundW;
  const grid = layout.gridBoundW;
  const features = [
    number(
      'pv_power',
      C.ENERGY_PRODUCTION_SENSOR,
      T.ENERGY_PRODUCTION_SENSOR.POWER,
      U.WATT,
      0,
      power,
      ['pvPowerKw'],
      (r) => positive(watts(r.pvPowerKw)),
      { main: true },
    ),
    houseFeature(layout, grid),
    number(
      'grid_power',
      C.GRID_SENSOR,
      T.GRID_SENSOR.POWER,
      U.WATT,
      -grid,
      grid,
      ['gridPowerKw'],
      (r) => watts(r.gridPowerKw),
      { main: true },
    ),
    number(
      'grid_import_power',
      C.GRID_SENSOR,
      T.GRID_SENSOR.INPUT_POWER,
      U.WATT,
      0,
      grid,
      ['gridPowerKw'],
      (r) => positive(watts(r.gridPowerKw)),
    ),
    number(
      'grid_export_power',
      C.GRID_SENSOR,
      T.GRID_SENSOR.OUTPUT_POWER,
      U.WATT,
      0,
      grid,
      ['gridPowerKw'],
      (r) => negativePart(watts(r.gridPowerKw)),
    ),
  ];

  if (layout.hasBattery) {
    features.push(
      number(
        'battery_level',
        C.BATTERY_STORAGE,
        T.BATTERY_STORAGE.BATTERY_LEVEL,
        U.PERCENT,
        0,
        100,
        ['socPercent'],
        (r) => r.socPercent,
        { precision: 1, main: true },
      ),
      number(
        'battery_charge_power',
        C.BATTERY_STORAGE,
        T.BATTERY_STORAGE.CHARGE_POWER,
        U.WATT,
        0,
        power,
        ['essPowerKw'],
        (r) => positive(watts(r.essPowerKw)),
      ),
      number(
        'battery_discharge_power',
        C.BATTERY_STORAGE,
        T.BATTERY_STORAGE.DISCHARGE_POWER,
        U.WATT,
        0,
        power,
        ['essPowerKw'],
        (r) => negativePart(watts(r.essPowerKw)),
      ),
      number(
        'battery_energy_remaining',
        C.BATTERY_STORAGE,
        T.BATTERY_STORAGE.BATTERY_ENERGY_REMAINING,
        U.KILOWATT_HOUR,
        0,
        Math.max(1, Math.ceil(layout.essCapacityKwh ?? 0)),
        ['essAvailableDischargeKwh'],
        (r) => r.essAvailableDischargeKwh,
        { precision: 2 },
      ),
    );
    if (supported('sohPercent')) {
      features.push(
        number(
          'battery_health',
          C.MAINTENANCE,
          T.MAINTENANCE.LIFE_REMAINING,
          U.PERCENT,
          0,
          100,
          ['sohPercent'],
          (r) => r.sohPercent,
          { precision: 1 },
        ),
      );
    }
  }

  const index = (key, category, type, register) =>
    supported(register)
      ? [
          number(
            key,
            category,
            type,
            U.KILOWATT_HOUR,
            0,
            INDEX_MAX,
            [register],
            (r) => r[register],
            {
              precision: 2,
              index: true,
            },
          ),
        ]
      : [];
  features.push(
    ...index(
      'pv_index',
      C.ENERGY_PRODUCTION_SENSOR,
      T.ENERGY_PRODUCTION_SENSOR.INDEX,
      'pvTotalKwh',
    ),
    ...index('house_index', C.ENERGY_SENSOR, T.ENERGY_SENSOR.INDEX, 'loadTotalKwh'),
    ...index('grid_import_index', C.GRID_SENSOR, T.GRID_SENSOR.INPUT_INDEX, 'gridImportKwh'),
    ...index('grid_export_index', C.GRID_SENSOR, T.GRID_SENSOR.OUTPUT_INDEX, 'gridExportKwh'),
  );
  if (layout.hasBattery) {
    features.push(
      ...index(
        'battery_charge_index',
        C.BATTERY_STORAGE,
        T.BATTERY_STORAGE.CHARGE_INDEX,
        'essChargedKwh',
      ),
      ...index(
        'battery_discharge_index',
        C.BATTERY_STORAGE,
        T.BATTERY_STORAGE.DISCHARGE_INDEX,
        'essDischargedKwh',
      ),
    );
  }

  features.push(
    text('ems_mode', ['emsWorkMode'], (r, { lang }) =>
      r.emsWorkMode === undefined
        ? undefined
        : { text: enumText(EMS_WORK_MODES, r.emsWorkMode, lang) },
    ),
    text('plant_state', ['runningState'], (r, { lang }) =>
      r.runningState === undefined
        ? undefined
        : { text: enumText(RUNNING_STATES, r.runningState, lang) },
    ),
    binary('off_grid', ['onOffGrid'], (r) =>
      r.onOffGrid === undefined ? undefined : r.onOffGrid === 0 ? 0 : 1,
    ),
    ...alarmFeatures(PLANT_ALARMS, PLANT, supported),
  );

  if (control && controllable(layout)) {
    features.push(...controlFeatures(layout));
  }
  return features;
}

/** Whether the battery can be driven: a battery, and its rated powers known. */
export function controllable(layout) {
  return Boolean(layout.hasBattery && layout.essRatedChargeW > 0 && layout.essRatedDischargeW > 0);
}

/**
 * The home consumption: the "total load power" register (V2.7), else the
 * "general load power" one, else what flows in minus what flows out.
 */
function houseFeature(layout, bound) {
  const sources = {
    total: { registers: ['totalLoadPowerKw'], value: (r) => positive(watts(r.totalLoadPowerKw)) },
    general: {
      registers: ['generalLoadPowerKw'],
      value: (r) => positive(watts(r.generalLoadPowerKw)),
    },
    computed: {
      registers: ['activePowerKw', 'gridPowerKw', 'thirdPartyPowerKw'],
      value: (r) =>
        r.activePowerKw === undefined || r.gridPowerKw === undefined
          ? undefined
          : positive(watts(r.activePowerKw + r.gridPowerKw + (r.thirdPartyPowerKw ?? 0))),
    },
  };
  const source = sources[layout.houseSource] ?? sources.computed;
  return number(
    'house_power',
    C.HOME_OUTPUT_SENSOR,
    T.HOME_OUTPUT_SENSOR.POWER,
    U.WATT,
    0,
    bound,
    source.registers,
    source.value,
    { main: true },
  );
}

/** The options of the control mode select, labelled in the configuration language. */
export function controlModeOptions(lang) {
  return CONTROL_MODE_KEYS.map((key, index) => ({
    value: key,
    label: pick(CONTROL_MODES[key].label, lang),
    sort_order: index,
  }));
}

/** The options of a limit select: "4 kW (40 %)". */
export function limitOptions(ratedW, lang) {
  const kw = new Intl.NumberFormat(lang, { maximumFractionDigits: 1, useGrouping: false });
  const percent = lang === 'en' ? (n) => `${n}%` : (n) => `${n} %`;
  return LIMIT_STEPS.map((step, index) => ({
    value: String(step),
    label: `${kw.format((ratedW * step) / 100 / 1000)} kW (${percent(step)})`,
    sort_order: index,
  }));
}

/** The nearest limit step of a limit in watts. */
export function limitStep(limitW, ratedW) {
  if (limitW === undefined || !(ratedW > 0)) {
    return undefined;
  }
  const percent = Math.min(100, Math.max(0, (limitW / ratedW) * 100));
  return String(Math.round(percent / 10) * 10);
}

function controlFeatures(layout) {
  const select = (key, registers, value, options, extra = {}) => ({
    key,
    name: key,
    category: C.TEXT,
    type: T.TEXT.SELECT,
    min: 0,
    max: 0,
    text: true,
    writable: true,
    registers,
    value,
    options,
    settings: true,
    ...extra,
  });
  return [
    select(
      'control_mode',
      ['remoteEmsEnable', 'remoteEmsMode'],
      (r) => {
        const mode = controlModeOf(r.remoteEmsEnable, r.remoteEmsMode);
        return mode ? { text: mode } : undefined;
      },
      controlModeOptions,
    ),
    select(
      'charge_limit',
      ['essMaxChargeKw'],
      (r) => {
        const step = limitStep(watts(r.essMaxChargeKw), layout.essRatedChargeW);
        return step === undefined ? undefined : { text: step };
      },
      (lang) => limitOptions(layout.essRatedChargeW, lang),
    ),
    select(
      'discharge_limit',
      ['essMaxDischargeKw'],
      (r) => {
        const step = limitStep(watts(r.essMaxDischargeKw), layout.essRatedDischargeW);
        return step === undefined ? undefined : { text: step };
      },
      (lang) => limitOptions(layout.essRatedDischargeW, lang),
    ),
  ];
}

/**
 * The features of an inverter device.
 * @param {object} layout what the probe found for this inverter
 */
export function inverterFeatures(layout) {
  const supported = (name) => layout.supported.includes(name);
  const power = layout.powerBoundW;
  const features = [
    number(
      'active_power',
      C.ENERGY_SENSOR,
      T.ENERGY_SENSOR.POWER,
      U.WATT,
      -power,
      power,
      ['activePowerKw'],
      (r) => watts(r.activePowerKw),
      { main: true },
    ),
    number(
      'pv_power',
      C.ENERGY_PRODUCTION_SENSOR,
      T.ENERGY_PRODUCTION_SENSOR.POWER,
      U.WATT,
      0,
      power,
      ['pvPowerKw'],
      (r) => positive(watts(r.pvPowerKw)),
      { main: true },
    ),
  ];
  if (layout.hasBattery) {
    features.push(
      number(
        'battery_level',
        C.BATTERY_STORAGE,
        T.BATTERY_STORAGE.BATTERY_LEVEL,
        U.PERCENT,
        0,
        100,
        ['socPercent'],
        (r) => r.socPercent,
        { precision: 1, main: true },
      ),
      number(
        'battery_charge_power',
        C.BATTERY_STORAGE,
        T.BATTERY_STORAGE.CHARGE_POWER,
        U.WATT,
        0,
        power,
        ['essPowerKw'],
        (r) => positive(watts(r.essPowerKw)),
      ),
      number(
        'battery_discharge_power',
        C.BATTERY_STORAGE,
        T.BATTERY_STORAGE.DISCHARGE_POWER,
        U.WATT,
        0,
        power,
        ['essPowerKw'],
        (r) => negativePart(watts(r.essPowerKw)),
      ),
    );
    if (supported('cellTemperature')) {
      features.push(temperature('battery_temperature', 'cellTemperature'));
    }
  }
  if (supported('pcsTemperature')) {
    features.push(temperature('pcs_temperature', 'pcsTemperature'));
  }

  const phases = layout.phases === 3 ? [1, 2, 3] : [1];
  const letters = { 1: 'A', 2: 'B', 3: 'C' };
  for (const n of phases) {
    const voltage = `phase${letters[n]}Voltage`;
    const current = `phase${letters[n]}Current`;
    const three = phases.length === 3;
    if (supported(voltage)) {
      features.push(
        number(
          three ? `voltage_l${n}` : 'voltage',
          C.ENERGY_SENSOR,
          T.ENERGY_SENSOR.VOLTAGE,
          U.VOLT,
          0,
          500,
          [voltage],
          (r) => positive(r[voltage]),
          { precision: 1, name: three ? 'voltage_phase' : 'voltage', n: three ? n : undefined },
        ),
      );
    }
    if (supported(current)) {
      features.push(
        number(
          three ? `current_l${n}` : 'current',
          C.ENERGY_SENSOR,
          T.ENERGY_SENSOR.CURRENT,
          U.AMPERE,
          -100,
          100,
          [current],
          (r) => r[current],
          { precision: 2, name: three ? 'current_phase' : 'current', n: three ? n : undefined },
        ),
      );
    }
  }

  for (let n = 1; n <= layout.pvStrings; n += 1) {
    const voltage = `pv${n}Voltage`;
    const current = `pv${n}Current`;
    features.push(
      number(
        `pv${n}_voltage`,
        C.ENERGY_SENSOR,
        T.ENERGY_SENSOR.VOLTAGE,
        U.VOLT,
        0,
        1100,
        [voltage],
        // A string at rest reads a few tenths below zero: no phantom value.
        (r) => positive(r[voltage]),
        { precision: 1, name: 'pv_voltage', n },
      ),
      number(
        `pv${n}_current`,
        C.ENERGY_SENSOR,
        T.ENERGY_SENSOR.CURRENT,
        U.AMPERE,
        0,
        40,
        [current],
        (r) => positive(r[current]),
        { precision: 2, name: 'pv_current', n },
      ),
    );
  }

  features.push(
    text('inverter_state', ['runningState'], (r, { lang }) =>
      r.runningState === undefined
        ? undefined
        : { text: enumText(RUNNING_STATES, r.runningState, lang) },
    ),
    ...alarmFeatures(INVERTER_ALARMS, INVERTER, supported),
  );
  return features;
}

function temperature(key, register) {
  return number(
    key,
    'device-temperature-sensor',
    'decimal',
    U.CELSIUS,
    -40,
    120,
    [register],
    (r) => r[register],
    { precision: 1 },
  );
}

/** The register of every name a feature reads, plant or inverter. */
export function plantRegister(name) {
  return PLANT[name] ?? PLANT_SETTINGS[name];
}

export function inverterRegister(name) {
  if (INVERTER[name]) {
    return INVERTER[name];
  }
  const match = /^pv(\d+)(Voltage|Current)$/.exec(name);
  if (match) {
    const registers = pvStringRegisters(Number(match[1]));
    return match[2] === 'Voltage' ? registers.voltage : registers.current;
  }
  return undefined;
}

export { THREE_PHASE_OUTPUTS };
