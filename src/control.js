// -----------------------------------------------------------------------------
// The battery commands: the control mode and the charge and discharge limits.
// One path for the three ways to give them (the device's selects, the
// widget's buttons, the scene actions), and the same checks for all:
//
// - control must be allowed in the configuration (off by default), and the
//   probe must have found a battery with its rated powers;
// - only the plant holding registers the protocol documents as writable are
//   written: remote EMS enable (40029), remote EMS control mode (40031), ESS
//   max charging limit (40032) and ESS max discharging limit (40034). Never
//   start/stop (40000), the grid code or the power dispatch registers;
// - a limit stays within [0, rated power] (30068 / 30070), as the protocol
//   requires;
// - the plant is read again right after, so that Gladys shows what it took.
//
// "auto" turns remote EMS off: the system goes back to the mode chosen in the
// mySigen app. The other modes turn it on, then set its control mode, in the
// order of the protocol (40031 only applies while 40029 is 1).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { formatNumber, localize, pick } from './i18n.js';
import { CONTROL_DONE } from './messages.js';
import { LIMIT_STEPS, controllable } from './model.js';
import { CONTROL_MODES } from './sigenergy/enums.js';
import { PLANT_SETTINGS, encode } from './sigenergy/registers.js';

const logger = createLogger({ name: 'sigenergy-control' });

/** The plant, ready to be driven, or a thrown error saying why not. */
function plantFor(hub) {
  if (!hub.config?.allow_control) {
    throw hub.controlError('disabled');
  }
  if (!hub.plant || !controllable(hub.plant.layout)) {
    throw hub.controlError('unavailable');
  }
  return hub.plant;
}

async function write(hub, register, value) {
  try {
    await hub.writePlant(register, encode(register, value));
  } catch (err) {
    throw hub.controlError('failed', err.message);
  }
}

/** Read the plant again and publish it: the state of the selects follows. */
async function readBack(hub, plant) {
  try {
    await hub.publishValues(plant, await hub.read(plant));
  } catch (err) {
    logger.debug(`Read back failed (${err.message})`);
  }
}

/**
 * Set the battery control mode.
 * @param {import('./hub.js').SigenergyHub} hub
 * @param {string} mode a key of CONTROL_MODES
 * @param {string} origin who asked, for the log line
 * @returns {Promise<{ mode: string, message: object }>}
 */
export async function setMode(hub, mode, origin) {
  const plant = plantFor(hub);
  const entry = CONTROL_MODES[mode];
  if (!entry) {
    throw hub.controlError('badMode', String(mode).slice(0, 40));
  }
  logger.info(`Battery mode set to ${mode} (${origin})`);
  if (entry.remote === null) {
    await write(hub, PLANT_SETTINGS.remoteEmsEnable, 0);
  } else {
    await write(hub, PLANT_SETTINGS.remoteEmsEnable, 1);
    await write(hub, PLANT_SETTINGS.remoteEmsMode, entry.remote);
  }
  await readBack(hub, plant);
  return {
    mode,
    message: localize(
      Object.fromEntries(
        Object.entries(CONTROL_DONE.mode).map(([lang, template]) => [
          lang,
          () => template(pick(entry.label, lang)),
        ]),
      ),
    ),
  };
}

/**
 * Set the charge and/or discharge limits, in watts.
 * @param {import('./hub.js').SigenergyHub} hub
 * @param {{ chargeW?: number, dischargeW?: number }} limits
 * @param {string} origin
 * @returns {Promise<{ chargeW?: number, dischargeW?: number, message: object }>}
 */
export async function setLimits(hub, { chargeW, dischargeW }, origin) {
  const plant = plantFor(hub);
  const { essRatedChargeW, essRatedDischargeW } = plant.layout;
  const given = (value) => value !== undefined && value !== null && value !== '';
  if (!given(chargeW) && !given(dischargeW)) {
    throw hub.controlError('noLimit');
  }
  const checked = (value, max) => {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > max) {
      throw hub.controlError('badLimit', String(value).slice(0, 16), max);
    }
    return Math.round(number);
  };
  const charge = given(chargeW) ? checked(chargeW, essRatedChargeW) : undefined;
  const discharge = given(dischargeW) ? checked(dischargeW, essRatedDischargeW) : undefined;
  logger.info(
    `Battery limits set (${origin}):` +
      `${charge !== undefined ? ` charge ${charge} W` : ''}` +
      `${discharge !== undefined ? ` discharge ${discharge} W` : ''}`,
  );
  if (charge !== undefined) {
    await write(hub, PLANT_SETTINGS.essMaxChargeKw, charge / 1000);
  }
  if (discharge !== undefined) {
    await write(hub, PLANT_SETTINGS.essMaxDischargeKw, discharge / 1000);
  }
  await readBack(hub, plant);
  const kw = (watts, lang) => `${formatNumber(watts / 1000, lang, 2)} kW`;
  const message = Object.fromEntries(
    Object.entries(CONTROL_DONE.limits).map(([lang, template]) => {
      const parts = [];
      if (charge !== undefined) {
        parts.push(`${pick(CONTROL_DONE.charge, lang)} ${kw(charge, lang)}`);
      }
      if (discharge !== undefined) {
        parts.push(`${pick(CONTROL_DONE.discharge, lang)} ${kw(discharge, lang)}`);
      }
      return [lang, template(parts.join(', '))];
    }),
  );
  return { chargeW: charge, dischargeW: discharge, message };
}

/**
 * A command from a device feature of the plant (the three selects).
 * @returns {Promise<void>}
 */
export async function setFeatureValue(hub, featureKey, value) {
  const plant = plantFor(hub);
  if (featureKey === 'control_mode') {
    await setMode(hub, String(value), 'device');
    return;
  }
  const step = Number(value);
  if (!LIMIT_STEPS.includes(step)) {
    throw hub.controlError('badLimit', String(value).slice(0, 16), 100);
  }
  const { essRatedChargeW, essRatedDischargeW } = plant.layout;
  if (featureKey === 'charge_limit') {
    await setLimits(hub, { chargeW: Math.round((essRatedChargeW * step) / 100) }, 'device');
  } else if (featureKey === 'discharge_limit') {
    await setLimits(hub, { dischargeW: Math.round((essRatedDischargeW * step) / 100) }, 'device');
  } else {
    throw hub.controlError('unavailable');
  }
}
