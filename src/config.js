// -----------------------------------------------------------------------------
// Integration configuration. DEFAULT_CONFIG mirrors the `default` values of
// the manifest (test/manifest.test.js checks both sides).
//
// One Sigenergy system per integration: the address of the SigenStor (or of
// the inverter its Modbus TCP server runs on), the unit id of the plant (247
// in the protocol) and the unit ids of the inverters, set in the mySigen app.
// -----------------------------------------------------------------------------

import { DEFAULT_LANGUAGE, LANGUAGES } from './i18n.js';
import { PLANT_UNIT_ID } from './sigenergy/registers.js';

export const POLL_INTERVALS = ['10', '15', '30', '60', '120', '300'];
export const MAX_INVERTERS = 8;

export const DEFAULT_CONFIG = {
  language: DEFAULT_LANGUAGE,
  host: '',
  port: 502,
  plant_unit_id: PLANT_UNIT_ID,
  inverter_unit_ids: '1',
  poll_interval: '15',
  allow_control: false,
};

/**
 * Merge the user config with the defaults, with the right types.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const config = { ...DEFAULT_CONFIG };
  for (const [key, value] of Object.entries(raw ?? {})) {
    // An emptied field arrives as null or "": keep the default.
    if (value !== null && value !== undefined && value !== '') {
      config[key] = value;
    }
  }
  if (!LANGUAGES.includes(config.language)) {
    config.language = DEFAULT_LANGUAGE;
  }
  if (!POLL_INTERVALS.includes(String(config.poll_interval))) {
    config.poll_interval = DEFAULT_CONFIG.poll_interval;
  }
  config.poll_interval = String(config.poll_interval);
  config.host = String(config.host).trim();
  config.inverter_unit_ids = String(config.inverter_unit_ids);
  config.allow_control = config.allow_control === true || config.allow_control === 'true';
  return config;
}

/** Milliseconds between two reads. */
export function pollIntervalMs(config) {
  return Number(config.poll_interval) * 1000;
}

/**
 * The system to read, and what is wrong in the configuration.
 * @param {object} config normalized
 * @returns {{ target: { host, port, plantUnitId, inverterUnitIds } | null, errors: Array<{ code, params }> }}
 */
export function readTarget(config) {
  const errors = [];
  const error = (code, params = {}) => errors.push({ code, params });
  const host = config.host;
  if (host === '') {
    error('noHost');
    return { target: null, errors };
  }
  // A host name or an IPv4 address: no scheme, no port, no credentials.
  if (!/^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/.test(host)) {
    // Never echo credentials typed by mistake (user:password@host).
    error('badHost', { host: host.replace(/^.*@/, '…@').slice(0, 64) });
    return { target: null, errors };
  }
  const port = Number(config.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    error('badPort', { port: String(config.port).slice(0, 16) });
    return { target: null, errors };
  }
  const plantUnitId = Number(config.plant_unit_id);
  if (!Number.isInteger(plantUnitId) || plantUnitId < 1 || plantUnitId > 247) {
    error('badPlantUnitId', { unitId: String(config.plant_unit_id).slice(0, 16) });
    return { target: null, errors };
  }
  const { ids, errors: idErrors } = parseUnitIds(config.inverter_unit_ids, plantUnitId);
  errors.push(...idErrors);
  if (ids.length === 0) {
    if (idErrors.length === 0) {
      error('noInverter');
    }
    return { target: null, errors };
  }
  return { target: { host, port, plantUnitId, inverterUnitIds: ids }, errors };
}

/**
 * "1, 2" → [1, 2]. Commas, semicolons or spaces separate the ids.
 * @returns {{ ids: number[], errors: Array<{ code, params }> }}
 */
export function parseUnitIds(text, plantUnitId = PLANT_UNIT_ID) {
  const ids = [];
  const errors = [];
  for (const token of String(text ?? '')
    .split(/[\s,;]+/)
    .filter(Boolean)) {
    const id = Number(token);
    if (!/^\d+$/.test(token) || id < 1 || id > 246) {
      errors.push({ code: 'badInverterUnitId', params: { unitId: token.slice(0, 16) } });
      continue;
    }
    if (id === plantUnitId) {
      errors.push({ code: 'inverterIsPlant', params: { unitId: id } });
      continue;
    }
    if (ids.includes(id)) {
      continue;
    }
    if (ids.length === MAX_INVERTERS) {
      errors.push({ code: 'tooManyInverters', params: { max: MAX_INVERTERS } });
      break;
    }
    ids.push(id);
  }
  return { ids, errors };
}
