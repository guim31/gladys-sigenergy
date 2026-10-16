// -----------------------------------------------------------------------------
// The "Test the connection" button of the Configuration screen: reads the
// plant and the configured inverters once, and says what answers. When no
// configured inverter answers, it looks for inverters at unit ids 1 to 16
// (the mySigen app sets them; an AC charger often takes 1, the inverter then
// another one).
//
// A result is shown in green, a thrown error in red. A thrown error carries a
// single text: it is written in the language of the configuration.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { formatNumber, joinLines, localize, pick } from './i18n.js';
import { CONFIG_ERRORS, STATUS } from './messages.js';
import { ModbusConnection, isUnreachable } from './modbus/connection.js';
import { EMS_WORK_MODES, RUNNING_STATES, enumText } from './sigenergy/enums.js';
import { PLANT, PLANT_SETTINGS } from './sigenergy/registers.js';
import { ProbeError, probeInverter, readNamed } from './probe.js';
import { errorText } from './hub.js';

const logger = createLogger({ name: 'sigenergy-actions' });

export const ACTION_KEYS = { TEST_CONNECTION: 'test_connection' };
export const SCAN_UNIT_IDS = Array.from({ length: 16 }, (_, i) => i + 1);
const SCAN_TIMEOUT_MS = 1000;

export const ACTION_TEXT = {
  plant: {
    en: (unit, mode, state) => `Plant (unit ${unit}): answers. Mode: ${mode}. State: ${state}.`,
    fr: (unit, mode, state) =>
      `Installation (identifiant ${unit}) : répond. Mode : ${mode}. État : ${state}.`,
    de: (unit, mode, state) =>
      `Anlage (Unit-ID ${unit}): antwortet. Modus: ${mode}. Zustand: ${state}.`,
    es: (unit, mode, state) =>
      `Instalación (identificador ${unit}): responde. Modo: ${mode}. Estado: ${state}.`,
  },
  power: {
    en: (pv, grid, soc) => `Solar ${pv}, grid ${grid}, battery ${soc}.`,
    fr: (pv, grid, soc) => `Solaire ${pv}, réseau ${grid}, batterie ${soc}.`,
    de: (pv, grid, soc) => `Solar ${pv}, Netz ${grid}, Batterie ${soc}.`,
    es: (pv, grid, soc) => `Solar ${pv}, red ${grid}, batería ${soc}.`,
  },
  plantFailed: {
    en: (unit, error) => `Plant (unit ${unit}): ${error}.`,
    fr: (unit, error) => `Installation (identifiant ${unit}) : ${error}.`,
    de: (unit, error) => `Anlage (Unit-ID ${unit}): ${error}.`,
    es: (unit, error) => `Instalación (identificador ${unit}): ${error}.`,
  },
  inverter: {
    en: (unit, model, serial, firmware) =>
      `Inverter ${unit}: ${model}, serial ${serial}, firmware ${firmware}.`,
    fr: (unit, model, serial, firmware) =>
      `Onduleur ${unit} : ${model}, n° de série ${serial}, micrologiciel ${firmware}.`,
    de: (unit, model, serial, firmware) =>
      `Wechselrichter ${unit}: ${model}, Seriennummer ${serial}, Firmware ${firmware}.`,
    es: (unit, model, serial, firmware) =>
      `Inversor ${unit}: ${model}, n.º de serie ${serial}, firmware ${firmware}.`,
  },
  inverterFailed: {
    en: (unit, error) => `Inverter ${unit}: ${error}.`,
    fr: (unit, error) => `Onduleur ${unit} : ${error}.`,
    de: (unit, error) => `Wechselrichter ${unit}: ${error}.`,
    es: (unit, error) => `Inversor ${unit}: ${error}.`,
  },
  found: {
    en: (ids) => `Inverters found at unit id(s) ${ids}: enter them in the configuration.`,
    fr: (ids) =>
      `Onduleurs trouvés à l’identifiant ${ids} : saisissez-le(s) dans la configuration.`,
    de: (ids) =>
      `Wechselrichter unter der Unit-ID ${ids} gefunden: Trage sie in der Konfiguration ein.`,
    es: (ids) =>
      `Inversores encontrados en el identificador ${ids}: introdúzcalos en la configuración.`,
  },
  notFound: {
    en: 'No inverter found at unit ids 1 to 16: check the ids in the mySigen app.',
    fr: 'Aucun onduleur trouvé aux identifiants 1 à 16 : vérifiez les identifiants dans l’appli mySigen.',
    de: 'Kein Wechselrichter unter den Unit-IDs 1 bis 16 gefunden: Prüfe die IDs in der mySigen-App.',
    es: 'No se ha encontrado ningún inversor en los identificadores 1 a 16: compruebe los identificadores en la app mySigen.',
  },
  remoteEms: {
    en: 'The battery control registers can be read.',
    fr: 'Les registres de pilotage de la batterie sont lisibles.',
    de: 'Die Register der Batteriesteuerung sind lesbar.',
    es: 'Los registros de control de la batería se pueden leer.',
  },
  noRemoteEms: {
    en: 'The battery control registers cannot be read: control will not work.',
    fr: 'Les registres de pilotage de la batterie ne sont pas lisibles : le pilotage ne fonctionnera pas.',
    de: 'Die Register der Batteriesteuerung sind nicht lesbar: Die Steuerung wird nicht funktionieren.',
    es: 'Los registros de control de la batería no se pueden leer: el control no funcionará.',
  },
  unreachable: {
    en: (error) => `The Sigenergy system does not answer: ${error}.`,
    fr: (error) => `L’installation Sigenergy ne répond pas : ${error}.`,
    de: (error) => `Die Sigenergy-Anlage antwortet nicht: ${error}.`,
    es: (error) => `La instalación Sigenergy no responde: ${error}.`,
  },
};

/** The last four characters of a serial number: enough to recognize it on a screenshot. */
export const maskSerial = (serial) => (serial ? `…${String(serial).slice(-4)}` : '?');

/**
 * @param {import('./hub.js').SigenergyHub} hub
 * @returns {Promise<object>} the message, in the four languages
 */
export async function testConnection(hub, { createSocket } = {}) {
  const lang = hub.lang;
  const target = hub.target;
  if (!target) {
    const error = hub.errors[0];
    const table = error ? CONFIG_ERRORS[error.code] : STATUS.notConfigured;
    const template = table[lang] ?? table.en;
    throw new Error(typeof template === 'function' ? template(error?.params ?? {}) : template);
  }
  logger.info('Action: test the connection');
  const connection = new ModbusConnection({
    host: target.host,
    port: target.port,
    timeoutMs: hub.timeoutMs,
    ...(createSocket ? { createSocket } : {}),
  });
  const lines = [];
  try {
    const { values, supported } = await readNamed(connection, target.plantUnitId, {
      emsWorkMode: PLANT.emsWorkMode,
      runningState: PLANT.runningState,
      pvPowerKw: PLANT.pvPowerKw,
      gridPowerKw: PLANT.gridPowerKw,
      socPercent: PLANT.socPercent,
    });
    if (supported.length === 0) {
      lines.push(
        localizeError(
          ACTION_TEXT.plantFailed,
          target.plantUnitId,
          new ProbeError('plantRefused', { unitId: target.plantUnitId }),
        ),
      );
    } else {
      lines.push(
        Object.fromEntries(
          ['en', 'fr', 'de', 'es'].map((l) => [
            l,
            ACTION_TEXT.plant[l](
              target.plantUnitId,
              values.emsWorkMode === undefined
                ? '?'
                : enumText(EMS_WORK_MODES, values.emsWorkMode, l),
              values.runningState === undefined
                ? '?'
                : enumText(RUNNING_STATES, values.runningState, l),
            ),
          ]),
        ),
        Object.fromEntries(
          ['en', 'fr', 'de', 'es'].map((l) => {
            const kw = (v) => (v === undefined ? '?' : `${formatNumber(v, l, 2)} kW`);
            const soc =
              values.socPercent === undefined
                ? '?'
                : `${formatNumber(values.socPercent, l, 1)}${l === 'en' ? '' : ' '}%`;
            return [l, ACTION_TEXT.power[l](kw(values.pvPowerKw), kw(values.gridPowerKw), soc)];
          }),
        ),
      );
      const settings = await readNamed(connection, target.plantUnitId, PLANT_SETTINGS);
      lines.push(
        settings.supported.length === Object.keys(PLANT_SETTINGS).length
          ? ACTION_TEXT.remoteEms
          : ACTION_TEXT.noRemoteEms,
      );
    }

    let found = 0;
    for (const unitId of target.inverterUnitIds) {
      try {
        const layout = await probeInverter(connection, unitId);
        found += 1;
        lines.push(
          localize(
            ACTION_TEXT.inverter,
            unitId,
            layout.model || '?',
            maskSerial(layout.serial),
            layout.firmware || '?',
          ),
        );
      } catch (err) {
        lines.push(localizeError(ACTION_TEXT.inverterFailed, unitId, err));
      }
    }
    if (found === 0) {
      const ids = await scanInverters(target, target.inverterUnitIds, {
        createSocket,
        timeoutMs: Math.min(SCAN_TIMEOUT_MS, hub.timeoutMs),
      });
      lines.push(
        ids.length > 0 ? localize(ACTION_TEXT.found, ids.join(', ')) : ACTION_TEXT.notFound,
      );
    }
  } catch (err) {
    if (!isUnreachable(err)) {
      throw err;
    }
    const template = ACTION_TEXT.unreachable[lang] ?? ACTION_TEXT.unreachable.en;
    throw new Error(template(err.message), { cause: err });
  } finally {
    connection.close();
  }
  return joinLines(lines);
}

/** A message whose last argument is an error, in each language. */
function localizeError(table, unitId, err) {
  const text = errorText(err);
  return Object.fromEntries(
    Object.entries(table).map(([lang, template]) => [lang, template(unitId, pick(text, lang))]),
  );
}

/** The unit ids from 1 to 16 that answer as Sigenergy inverters. */
export async function scanInverters(
  target,
  skip,
  { createSocket, timeoutMs = SCAN_TIMEOUT_MS } = {},
) {
  const connection = new ModbusConnection({
    host: target.host,
    port: target.port,
    timeoutMs,
    ...(createSocket ? { createSocket } : {}),
  });
  const ids = [];
  try {
    for (const unitId of SCAN_UNIT_IDS) {
      if (skip.includes(unitId) || unitId === target.plantUnitId) {
        continue;
      }
      try {
        await probeInverter(connection, unitId);
        ids.push(unitId);
      } catch (err) {
        logger.debug(`Unit ${unitId}: not an inverter (${err.message})`);
        // A connection that broke: the next unit gets a fresh one.
      }
    }
  } finally {
    connection.close();
  }
  return ids;
}
