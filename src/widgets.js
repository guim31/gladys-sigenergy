// -----------------------------------------------------------------------------
// The "Sigenergy energy flow" dashboard widget: solar, home, grid and battery
// at a glance, as live tiles that follow the published states, plus what a
// device box cannot say in one line: which way the battery goes, the
// operating mode, the alarms, whether the system answers. When battery
// control is allowed, three buttons switch the battery mode (with a
// confirmation): automatic, forced charge from the grid, forced discharge.
//
// Budget of the core: 8 components at most (6 tiles, 1 status, 4 buttons).
// Here: 4 tiles + 1 status + 3 buttons. The current mode is marked by the
// check-circle icon, never by the button style (invisible in dark mode, #3153).
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { LANGUAGES, formatNumber, pick } from './i18n.js';
import { setMode } from './control.js';
import { CONTROL_MODES } from './sigenergy/enums.js';

export const WIDGET_KEY = 'energy_flow';

/** The buttons: action keys are distinct (the core drops a duplicate), and forever. */
export const WIDGET_BUTTONS = [
  { action: 'mode_auto', mode: 'auto', icon: 'refresh-cw' },
  { action: 'mode_charge', mode: 'charge_grid', icon: 'battery-charging' },
  { action: 'mode_discharge', mode: 'discharge_ess', icon: 'zap' },
];

export const TEXT = {
  notReady: {
    en: 'No data yet: save the address of the system, then add it from the Discovery tab.',
    fr: 'Pas encore de données : enregistrez l’adresse de l’installation, puis ajoutez-la depuis l’onglet Découverte.',
    de: 'Noch keine Daten: Speichere die Adresse der Anlage und füge sie im Tab „Entdecken“ hinzu.',
    es: 'Aún no hay datos: guarde la dirección de la instalación y añádala desde la pestaña Descubrimiento.',
  },
  solar: { en: 'Solar', fr: 'Solaire', de: 'Solar', es: 'Solar' },
  home: { en: 'Home', fr: 'Maison', de: 'Haus', es: 'Casa' },
  grid: { en: 'Grid', fr: 'Réseau', de: 'Netz', es: 'Red' },
  battery: { en: 'Battery', fr: 'Batterie', de: 'Batterie', es: 'Batería' },
  charging: {
    en: (kw) => `Charging, ${kw}`,
    fr: (kw) => `En charge, ${kw}`,
    de: (kw) => `Lädt, ${kw}`,
    es: (kw) => `Cargando, ${kw}`,
  },
  discharging: {
    en: (kw) => `Discharging, ${kw}`,
    fr: (kw) => `En décharge, ${kw}`,
    de: (kw) => `Entlädt, ${kw}`,
    es: (kw) => `Descargando, ${kw}`,
  },
  idle: { en: 'Idle', fr: 'Au repos', de: 'Ruht', es: 'En reposo' },
  mode: { en: 'Mode', fr: 'Mode', de: 'Modus', es: 'Modo' },
  alarms: { en: 'Alarms', fr: 'Alarmes', de: 'Alarme', es: 'Alarmas' },
  none: { en: 'None', fr: 'Aucune', de: 'Keine', es: 'Ninguna' },
  link: { en: 'Link', fr: 'Liaison', de: 'Verbindung', es: 'Enlace' },
  silent: { en: 'Not answering', fr: 'Ne répond pas', de: 'Antwortet nicht', es: 'No responde' },
  auto: { en: 'Automatic', fr: 'Automatique', de: 'Automatisch', es: 'Automático' },
  charge: { en: 'Charge', fr: 'Charger', de: 'Laden', es: 'Cargar' },
  discharge: { en: 'Discharge', fr: 'Décharger', de: 'Entladen', es: 'Descargar' },
};

const BUTTON_LABELS = { mode_auto: 'auto', mode_charge: 'charge', mode_discharge: 'discharge' };

/**
 * The content of the widget.
 * @param {import('./hub.js').SigenergyHub} hub
 * @param {{ language?: string }} request
 */
export function energyFlowContent(hub, { language = 'en' } = {}) {
  const lang = LANGUAGES.includes(language) ? language : 'en';
  const plant = hub.plant;
  const created = plant && hub.createdDevice(plant);
  if (!created) {
    return {
      ttl_seconds: 300,
      components: [{ type: 'text', variant: 'body', text: TEXT.notReady }],
    };
  }
  const known = new Set((created.features ?? []).map((feature) => feature.external_id));
  const has = (key) => plant.features.some((feature) => feature.key === key);
  const id = (key) => plant.ids.feature(key);
  const usable = (key) => has(key) && (known.size === 0 || known.has(id(key)));

  const components = [];
  for (const [key, label] of [
    ['pv_power', TEXT.solar],
    ['house_power', TEXT.home],
    ['grid_power', TEXT.grid],
  ]) {
    if (usable(key)) {
      components.push({ type: 'value', label, device_feature: id(key) });
    }
  }
  if (usable('battery_level')) {
    components.push({ type: 'gauge', label: TEXT.battery, device_feature: id('battery_level') });
  }

  const values = plant.values ?? new Map();
  const items = [];
  if (has('battery_charge_power')) {
    const charge = values.get('battery_charge_power') ?? 0;
    const discharge = values.get('battery_discharge_power') ?? 0;
    const kw = (watts) => `${formatNumber(watts / 1000, lang, 1)} kW`;
    items.push({
      label: TEXT.battery,
      value:
        charge > 0
          ? TEXT.charging[lang](kw(charge))
          : discharge > 0
            ? TEXT.discharging[lang](kw(discharge))
            : pick(TEXT.idle, lang),
      color:
        charge > 0
          ? WIDGET_COLORS.SUCCESS
          : discharge > 0
            ? WIDGET_COLORS.INFO
            : WIDGET_COLORS.NEUTRAL,
    });
  }
  const mode = values.get('ems_mode');
  if (mode?.text) {
    items.push({ label: TEXT.mode, value: truncate(mode.text, 40) });
  }
  if (has('alarms')) {
    const alarms = plant.alarms ?? [];
    items.push({
      label: TEXT.alarms,
      value: alarms.length === 0 ? pick(TEXT.none, lang) : truncate(pick(alarms[0].text, lang), 40),
      color: alarms.length === 0 ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.DANGER,
    });
  }
  if (hub.status.reachable === false) {
    items.push({ label: TEXT.link, value: pick(TEXT.silent, lang), color: WIDGET_COLORS.DANGER });
  }
  if (items.length > 0) {
    components.push({ type: 'status', items });
  }

  if (hub.controlState() === 'on') {
    const current = values.get('control_mode')?.text;
    for (const button of WIDGET_BUTTONS) {
      components.push({
        type: 'button',
        label: TEXT[BUTTON_LABELS[button.action]],
        icon: current === button.mode ? 'check-circle' : button.icon,
        style: 'secondary',
        action: { key: button.action, params: { mode: button.mode }, confirm: true },
      });
    }
  }
  return { ttl_seconds: 30, components };
}

/**
 * A tap on a widget button.
 * @returns {Promise<object>} the toast message
 */
export async function energyFlowAction(hub, actionKey, params = {}) {
  const button = WIDGET_BUTTONS.find((candidate) => candidate.action === actionKey);
  const mode = button?.mode ?? params.mode;
  if (!CONTROL_MODES[mode]) {
    throw hub.controlError('badMode', String(actionKey).slice(0, 40));
  }
  const { message } = await setMode(hub, mode, 'widget');
  return message;
}

function truncate(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
