// -----------------------------------------------------------------------------
// The enumerations and alarm bits of the Sigenergy Modbus Protocol V2.9, with
// their texts in the four languages of the Gladys interface. German says
// "du", Spanish "usted"; Sigenergy, SigenStor and mySigen stay as they are.
// -----------------------------------------------------------------------------

import { LANGUAGES } from '../i18n.js';

/** [en, fr, de, es] → { en, fr, de, es } */
const t = (en, fr, de, es) => ({ en, fr, de, es });

/** Running state (appendix 1), plant 30051 and inverter 30578. */
export const RUNNING_STATES = {
  0: t('Standby', 'En veille', 'Standby', 'En espera'),
  1: t('Running', 'En marche', 'In Betrieb', 'En funcionamiento'),
  2: t('Fault', 'Défaut', 'Störung', 'Avería'),
  3: t('Shut down', 'Arrêté', 'Abgeschaltet', 'Apagado'),
  7: t(
    'Environmental abnormality',
    'Anomalie environnementale',
    'Umgebungsstörung',
    'Anomalía ambiental',
  ),
};

/** EMS work mode (30003), as chosen in the mySigen app or forced by remote EMS. */
export const EMS_WORK_MODES = {
  0: t(
    'Maximum self-consumption',
    'Autoconsommation maximale',
    'Maximaler Eigenverbrauch',
    'Autoconsumo máximo',
  ),
  1: t('AI mode', 'Mode IA', 'KI-Modus', 'Modo IA'),
  2: t('Time of use (TOU)', 'Plages horaires (TOU)', 'Zeittarif (TOU)', 'Franjas horarias (TOU)'),
  5: t(
    'Full feed-in to the grid',
    'Injection totale',
    'Volleinspeisung',
    'Inyección total a la red',
  ),
  7: t(
    'Remote control (remote EMS)',
    'Pilotage à distance',
    'Fernsteuerung (Remote-EMS)',
    'Control remoto (EMS remoto)',
  ),
  9: t('Custom', 'Personnalisé', 'Benutzerdefiniert', 'Personalizado'),
};

export const UNKNOWN = {
  en: (code) => `Unknown (${code})`,
  fr: (code) => `Inconnu (${code})`,
  de: (code) => `Unbekannt (${code})`,
  es: (code) => `Desconocido (${code})`,
};

/** The text of an enumeration value, "Unknown (n)" for a value the protocol does not list. */
export function enumText(table, code, lang) {
  const entry = table[code];
  if (entry) {
    return entry[lang] ?? entry.en;
  }
  return (UNKNOWN[lang] ?? UNKNOWN.en)(code);
}

/**
 * The battery modes Gladys offers (the "Control mode" select, the scene action,
 * the widget buttons). `auto` turns remote EMS off (40029 = 0): the system goes
 * back to the mode chosen in the mySigen app. The others turn remote EMS on
 * (40029 = 1) with a remote EMS control mode (40031, appendix 6).
 * Keys are forever: they are stored by scenes and by the select's states.
 */
export const CONTROL_MODES = {
  auto: {
    remote: null,
    label: t(
      'Automatic (app mode)',
      'Automatique (mode de l’appli)',
      'Automatisch (App-Modus)',
      'Automático (modo de la app)',
    ),
  },
  self_consumption: {
    remote: 2,
    label: t(
      'Maximum self-consumption',
      'Autoconsommation maximale',
      'Maximaler Eigenverbrauch',
      'Autoconsumo máximo',
    ),
  },
  charge_grid: {
    remote: 3,
    label: t(
      'Forced charge (grid first)',
      'Charge forcée (réseau d’abord)',
      'Zwangsladung (Netz zuerst)',
      'Carga forzada (red primero)',
    ),
  },
  charge_pv: {
    remote: 4,
    label: t(
      'Forced charge (solar first)',
      'Charge forcée (solaire d’abord)',
      'Zwangsladung (Solar zuerst)',
      'Carga forzada (solar primero)',
    ),
  },
  discharge_pv: {
    remote: 5,
    label: t(
      'Forced discharge (solar first)',
      'Décharge forcée (solaire d’abord)',
      'Zwangsentladung (Solar zuerst)',
      'Descarga forzada (solar primero)',
    ),
  },
  discharge_ess: {
    remote: 6,
    label: t(
      'Forced discharge (battery first)',
      'Décharge forcée (batterie d’abord)',
      'Zwangsentladung (Batterie zuerst)',
      'Descarga forzada (batería primero)',
    ),
  },
  standby: {
    remote: 1,
    label: t(
      'Standby (battery idle)',
      'Veille (batterie au repos)',
      'Standby (Batterie ruht)',
      'En espera (batería en reposo)',
    ),
  },
};

export const CONTROL_MODE_KEYS = Object.keys(CONTROL_MODES);

/** The control mode of the remote EMS registers, undefined for a mode Gladys does not offer. */
export function controlModeOf(remoteEnable, remoteMode) {
  if (remoteEnable === 0) {
    return 'auto';
  }
  if (remoteEnable !== 1) {
    return undefined;
  }
  return CONTROL_MODE_KEYS.find((key) => CONTROL_MODES[key].remote === remoteMode);
}

/** Who raised an alarm: the first words of its text. */
const SOURCES = {
  pcs: t('Inverter', 'Onduleur', 'Wechselrichter', 'Inversor'),
  ess: t('Battery', 'Batterie', 'Batterie', 'Batería'),
  gateway: t('Gateway', 'Passerelle', 'Gateway', 'Pasarela'),
  dcCharger: t('DC charger', 'Borne DC', 'DC-Ladegerät', 'Cargador DC'),
  plant: t('System', 'Installation', 'Anlage', 'Instalación'),
};

const SOFTWARE_MISMATCH = t(
  'software version mismatch',
  'versions logicielles incompatibles',
  'Softwareversionen passen nicht zusammen',
  'versiones de software incompatibles',
);
const LOW_INSULATION = t(
  'low insulation resistance',
  'résistance d’isolement faible',
  'niedriger Isolationswiderstand',
  'resistencia de aislamiento baja',
);
const OVER_TEMPERATURE = t('over-temperature', 'surchauffe', 'Übertemperatur', 'sobretemperatura');
const EQUIPMENT_FAULT = t('equipment fault', 'défaut matériel', 'Gerätefehler', 'fallo del equipo');
const PHASE_SEQUENCE = t(
  'abnormal phase sequence',
  'ordre des phases anormal',
  'falsche Phasenfolge',
  'secuencia de fases anómala',
);

/**
 * The alarm registers, bit by bit (appendices 2 to 5, 11 to 13). A bit the
 * protocol does not define reads "alarm <register>.<bit>".
 */
export const ALARM_REGISTERS = {
  // Appendix 2, PCS alarm code 1 (plant 30027, inverter 30605)
  pcs1: {
    source: 'pcs',
    bits: {
      0: SOFTWARE_MISMATCH,
      1: LOW_INSULATION,
      2: OVER_TEMPERATURE,
      3: EQUIPMENT_FAULT,
      4: t(
        'system grounding fault',
        'défaut de mise à la terre',
        'Erdungsfehler',
        'fallo de puesta a tierra',
      ),
      5: t(
        'PV string over-voltage',
        'surtension d’une chaîne PV',
        'Überspannung eines PV-Strings',
        'sobretensión de una cadena FV',
      ),
      6: t('PV string reversed', 'chaîne PV inversée', 'PV-String verpolt', 'cadena FV invertida'),
      7: t(
        'PV string back-feeding',
        'retour de courant dans une chaîne PV',
        'Rückstrom in einem PV-String',
        'retorno de corriente en una cadena FV',
      ),
      8: t(
        'arc fault (AFCI)',
        'défaut d’arc (AFCI)',
        'Lichtbogenfehler (AFCI)',
        'fallo de arco (AFCI)',
      ),
      9: t('grid power outage', 'coupure du réseau', 'Netzausfall', 'corte de la red'),
      10: t(
        'grid over-voltage',
        'surtension du réseau',
        'Netzüberspannung',
        'sobretensión de la red',
      ),
      11: t(
        'grid under-voltage',
        'sous-tension du réseau',
        'Netzunterspannung',
        'subtensión de la red',
      ),
      12: t(
        'grid over-frequency',
        'surfréquence du réseau',
        'Netzüberfrequenz',
        'sobrefrecuencia de la red',
      ),
      13: t(
        'grid under-frequency',
        'sous-fréquence du réseau',
        'Netzunterfrequenz',
        'subfrecuencia de la red',
      ),
      14: t(
        'grid voltage imbalance',
        'déséquilibre de tension du réseau',
        'Netzspannungsunsymmetrie',
        'desequilibrio de tensión de la red',
      ),
      15: t(
        'DC component of the output current too high',
        'composante continue du courant de sortie trop forte',
        'Gleichanteil des Ausgangsstroms zu hoch',
        'componente continua de la corriente de salida demasiado alta',
      ),
    },
  },
  // Appendix 3, PCS alarm code 2 (plant 30028, inverter 30606)
  pcs2: {
    source: 'pcs',
    bits: {
      0: t(
        'leakage current too high',
        'courant de fuite trop fort',
        'Ableitstrom zu hoch',
        'corriente de fuga demasiado alta',
      ),
      1: t(
        'communication fault',
        'défaut de communication',
        'Kommunikationsfehler',
        'fallo de comunicación',
      ),
      2: t(
        'internal protection',
        'protection interne',
        'interne Schutzabschaltung',
        'protección interna',
      ),
      3: t(
        'AFCI self-test fault',
        'défaut d’autotest AFCI',
        'AFCI-Selbsttestfehler',
        'fallo de autodiagnóstico AFCI',
      ),
      4: t(
        'off-grid protection',
        'protection hors réseau',
        'Inselnetzschutz',
        'protección fuera de red',
      ),
      5: t(
        'manual operation protection',
        'protection d’intervention manuelle',
        'Schutz bei manuellem Eingriff',
        'protección por intervención manual',
      ),
      7: PHASE_SEQUENCE,
      8: t(
        'short circuit to earth',
        'court-circuit à la terre',
        'Kurzschluss gegen Erde',
        'cortocircuito a tierra',
      ),
      9: t(
        'soft start failure',
        'échec du démarrage progressif',
        'Sanftanlauf fehlgeschlagen',
        'fallo del arranque suave',
      ),
    },
  },
  // Appendix 4, ESS alarm code (plant 30029, inverter 30607)
  ess: {
    source: 'ess',
    bits: {
      0: SOFTWARE_MISMATCH,
      1: LOW_INSULATION,
      2: OVER_TEMPERATURE,
      3: EQUIPMENT_FAULT,
      4: t(
        'under-temperature',
        'température trop basse',
        'Untertemperatur',
        'temperatura demasiado baja',
      ),
      5: t(
        'internal protection',
        'protection interne',
        'interne Schutzabschaltung',
        'protección interna',
      ),
      6: t(
        'thermal runaway',
        'emballement thermique',
        'thermisches Durchgehen',
        'embalamiento térmico',
      ),
    },
  },
  // Appendix 5, gateway alarm code (plant 30030, inverter 30608)
  gateway: {
    source: 'gateway',
    bits: {
      0: SOFTWARE_MISMATCH,
      1: OVER_TEMPERATURE,
      2: EQUIPMENT_FAULT,
      3: t(
        'leakage current too high on the backup output',
        'courant de fuite trop fort sur la sortie secours',
        'Ableitstrom am Notstromausgang zu hoch',
        'corriente de fuga demasiado alta en la salida de respaldo',
      ),
      4: t(
        'neutral grounding fault',
        'défaut de terre du neutre',
        'Erdungsfehler des Neutralleiters',
        'fallo de tierra del neutro',
      ),
      5: t(
        'abnormal phase sequence (grid wiring)',
        'ordre des phases anormal (câblage réseau)',
        'falsche Phasenfolge (Netzverkabelung)',
        'secuencia de fases anómala (cableado de red)',
      ),
      6: t(
        'abnormal phase sequence (inverter wiring)',
        'ordre des phases anormal (câblage onduleur)',
        'falsche Phasenfolge (Wechselrichterverkabelung)',
        'secuencia de fases anómala (cableado del inversor)',
      ),
      7: t(
        'grid phase loss',
        'perte d’une phase du réseau',
        'Ausfall einer Netzphase',
        'pérdida de una fase de la red',
      ),
    },
  },
  // Appendix 11, DC charger alarm code (plant 30072, inverter 30609)
  dcCharger: {
    source: 'dcCharger',
    bits: {
      0: SOFTWARE_MISMATCH,
      1: LOW_INSULATION,
      2: OVER_TEMPERATURE,
      3: EQUIPMENT_FAULT,
      4: t('charging fault', 'défaut de charge', 'Ladefehler', 'fallo de carga'),
      5: t(
        'equipment protection',
        'protection de l’équipement',
        'Geräteschutz',
        'protección del equipo',
      ),
    },
  },
  // Appendix 12, plant alarm 1 (plant 30280)
  plant1: {
    source: 'plant',
    bits: {
      0: t(
        'gateway communication fault',
        'défaut de communication avec la passerelle',
        'Kommunikationsfehler mit dem Gateway',
        'fallo de comunicación con la pasarela',
      ),
      1: t(
        'meter communication fault',
        'défaut de communication avec le compteur',
        'Kommunikationsfehler mit dem Zähler',
        'fallo de comunicación con el contador',
      ),
      2: t(
        'AC power sensor communication fault',
        'défaut de communication avec le capteur de puissance',
        'Kommunikationsfehler mit dem Leistungssensor',
        'fallo de comunicación con el sensor de potencia',
      ),
      6: t(
        'hard protection: grid feed-in limit exceeded',
        'protection : limite d’injection dépassée',
        'Schutz: Einspeisegrenze überschritten',
        'protección: límite de inyección superado',
      ),
      8: t(
        'generator failed to start',
        'échec du démarrage du groupe électrogène',
        'Generator startet nicht',
        'el generador no arranca',
      ),
      10: t('CLS fault', 'défaut CLS', 'CLS-Fehler', 'fallo CLS'),
    },
  },
  // Appendix 13, plant alarm 2 (plant 30281)
  plant2: {
    source: 'plant',
    bits: {
      0: t('OVGR fault', 'défaut OVGR', 'OVGR-Fehler', 'fallo OVGR'),
      1: t('RPR fault', 'défaut RPR', 'RPR-Fehler', 'fallo RPR'),
    },
  },
};

const UNDEFINED_BIT = {
  en: (register, bit) => `alarm ${register}.${bit}`,
  fr: (register, bit) => `alarme ${register}.${bit}`,
  de: (register, bit) => `Alarm ${register}.${bit}`,
  es: (register, bit) => `alarma ${register}.${bit}`,
};

/**
 * The active alarms of a set of alarm registers.
 * @param {Array<{ table: string, address: number, value: number | undefined }>} registers
 * @returns {Array<{ id: string, text: Record<string, string> }>} one entry per raised bit, `id` stable
 */
export function activeAlarms(registers) {
  const alarms = [];
  for (const { table, address, value } of registers) {
    if (!Number.isInteger(value) || value === 0) {
      continue;
    }
    const { source, bits } = ALARM_REGISTERS[table];
    for (let bit = 0; bit < 16; bit += 1) {
      if ((value & (1 << bit)) === 0) {
        continue;
      }
      const text = Object.fromEntries(
        LANGUAGES.map((lang) => {
          const what = bits[bit]?.[lang] ?? UNDEFINED_BIT[lang](address, bit);
          return [lang, `${SOURCES[source][lang]}${lang === 'fr' ? ' : ' : ': '}${what}`];
        }),
      );
      alarms.push({ id: `${table}.${bit}`, text });
    }
  }
  return alarms;
}
