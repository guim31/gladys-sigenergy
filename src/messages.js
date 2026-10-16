// -----------------------------------------------------------------------------
// The texts the container sends to Gladys: the connection status of the
// Configuration screen, the configuration mistakes, the errors of a command.
// Four languages; German says "du", Spanish "usted".
// -----------------------------------------------------------------------------

import { localize } from './i18n.js';

const list = (ids) => ids.join(', ');

export const STATUS = {
  notConfigured: {
    en: 'Enter the address of your SigenStor (or of the inverter running its Modbus TCP server), then save.',
    fr: 'Saisissez l’adresse de votre SigenStor (ou de l’onduleur qui porte son serveur Modbus TCP), puis enregistrez.',
    de: 'Gib die Adresse deines SigenStor (oder des Wechselrichters mit dem Modbus-TCP-Server) ein und speichere.',
    es: 'Introduzca la dirección de su SigenStor (o del inversor que aloja su servidor Modbus TCP) y guarde.',
  },
  configErrors: {
    en: 'The configuration has mistakes:',
    fr: 'La configuration comporte des erreurs :',
    de: 'Die Konfiguration enthält Fehler:',
    es: 'La configuración contiene errores:',
  },
  answering: {
    en: (count) => `The Sigenergy system answers: ${count} inverter(s) read.`,
    fr: (count) => `L’installation Sigenergy répond : ${count} onduleur(s) lu(s).`,
    de: (count) => `Die Sigenergy-Anlage antwortet: ${count} Wechselrichter gelesen.`,
    es: (count) => `La instalación Sigenergy responde: ${count} inversor(es) leído(s).`,
  },
  notAnswering: {
    en: (error) =>
      `The Sigenergy system does not answer (${error}). Check the address and that Modbus TCP is enabled for your system (see the documentation).`,
    fr: (error) =>
      `L’installation Sigenergy ne répond pas (${error}). Vérifiez l’adresse et que Modbus TCP est activé pour votre installation (voir la documentation).`,
    de: (error) =>
      `Die Sigenergy-Anlage antwortet nicht (${error}). Prüfe die Adresse und ob Modbus TCP für deine Anlage aktiviert ist (siehe Dokumentation).`,
    es: (error) =>
      `La instalación Sigenergy no responde (${error}). Compruebe la dirección y que Modbus TCP está activado para su instalación (vea la documentación).`,
  },
  noInverter: {
    en: (ids) =>
      `No inverter answers at unit id(s) ${list(ids)}. The "Test the connection" button looks for them.`,
    fr: (ids) =>
      `Aucun onduleur ne répond à l’identifiant ${list(ids)}. Le bouton « Tester la connexion » les cherche.`,
    de: (ids) =>
      `Kein Wechselrichter antwortet unter der Unit-ID ${list(ids)}. Die Schaltfläche „Verbindung testen“ sucht sie.`,
    es: (ids) =>
      `Ningún inversor responde en el identificador ${list(ids)}. El botón «Probar la conexión» los busca.`,
  },
  inverterSilent: {
    en: (id) => `Inverter ${id} does not answer.`,
    fr: (id) => `L’onduleur ${id} ne répond pas.`,
    de: (id) => `Wechselrichter ${id} antwortet nicht.`,
    es: (id) => `El inversor ${id} no responde.`,
  },
  controlOn: {
    en: 'Battery control is allowed.',
    fr: 'Le pilotage de la batterie est autorisé.',
    de: 'Die Batteriesteuerung ist erlaubt.',
    es: 'El control de la batería está permitido.',
  },
  controlOff: {
    en: 'Read only: battery control is off.',
    fr: 'Lecture seule : le pilotage de la batterie est désactivé.',
    de: 'Nur lesen: Die Batteriesteuerung ist aus.',
    es: 'Solo lectura: el control de la batería está desactivado.',
  },
  controlUnavailable: {
    en: 'Battery control is allowed, but no battery was found.',
    fr: 'Le pilotage est autorisé, mais aucune batterie n’a été trouvée.',
    de: 'Die Steuerung ist erlaubt, aber es wurde keine Batterie gefunden.',
    es: 'El control está permitido, pero no se ha encontrado ninguna batería.',
  },
  initFailed: {
    en: 'Initialization failed, check the integration logs.',
    fr: 'L’initialisation a échoué, consultez les journaux de l’intégration.',
    de: 'Die Initialisierung ist fehlgeschlagen, sieh dir die Protokolle der Integration an.',
    es: 'La inicialización ha fallado, consulte los registros de la integración.',
  },
};

export const CONFIG_ERRORS = {
  noHost: STATUS.notConfigured,
  badHost: {
    en: ({ host }) => `"${host}" is not a host name or an IP address (no http://, no port).`,
    fr: ({ host }) =>
      `« ${host} » n’est pas un nom d’hôte ni une adresse IP (sans http://, sans port).`,
    de: ({ host }) => `„${host}“ ist kein Hostname und keine IP-Adresse (ohne http://, ohne Port).`,
    es: ({ host }) =>
      `«${host}» no es un nombre de host ni una dirección IP (sin http://, sin puerto).`,
  },
  badPort: {
    en: ({ port }) => `The port ${port} is not a number from 1 to 65535.`,
    fr: ({ port }) => `Le port ${port} n’est pas un nombre de 1 à 65535.`,
    de: ({ port }) => `Der Port ${port} ist keine Zahl von 1 bis 65535.`,
    es: ({ port }) => `El puerto ${port} no es un número de 1 a 65535.`,
  },
  badPlantUnitId: {
    en: ({ unitId }) =>
      `The plant unit id ${unitId} is not a number from 1 to 247 (247 by default).`,
    fr: ({ unitId }) =>
      `L’identifiant de l’installation ${unitId} n’est pas un nombre de 1 à 247 (247 par défaut).`,
    de: ({ unitId }) =>
      `Die Unit-ID der Anlage ${unitId} ist keine Zahl von 1 bis 247 (Standard 247).`,
    es: ({ unitId }) =>
      `El identificador de la instalación ${unitId} no es un número de 1 a 247 (247 por defecto).`,
  },
  badInverterUnitId: {
    en: ({ unitId }) => `The inverter unit id "${unitId}" is not a number from 1 to 246.`,
    fr: ({ unitId }) => `L’identifiant d’onduleur « ${unitId} » n’est pas un nombre de 1 à 246.`,
    de: ({ unitId }) => `Die Unit-ID „${unitId}“ des Wechselrichters ist keine Zahl von 1 bis 246.`,
    es: ({ unitId }) => `El identificador de inversor «${unitId}» no es un número de 1 a 246.`,
  },
  inverterIsPlant: {
    en: ({ unitId }) => `The unit id ${unitId} is the plant's, not an inverter's.`,
    fr: ({ unitId }) => `L’identifiant ${unitId} est celui de l’installation, pas d’un onduleur.`,
    de: ({ unitId }) => `Die Unit-ID ${unitId} gehört der Anlage, nicht einem Wechselrichter.`,
    es: ({ unitId }) => `El identificador ${unitId} es el de la instalación, no el de un inversor.`,
  },
  tooManyInverters: {
    en: ({ max }) => `At most ${max} inverters: the next ones are ignored.`,
    fr: ({ max }) => `${max} onduleurs au plus : les suivants sont ignorés.`,
    de: ({ max }) => `Höchstens ${max} Wechselrichter: Die weiteren werden ignoriert.`,
    es: ({ max }) => `Como máximo ${max} inversores: los siguientes se ignoran.`,
  },
  noInverter: {
    en: 'Enter the unit id of at least one inverter (1 by default).',
    fr: 'Saisissez l’identifiant d’au moins un onduleur (1 par défaut).',
    de: 'Gib die Unit-ID mindestens eines Wechselrichters ein (Standard 1).',
    es: 'Introduzca el identificador de al menos un inversor (1 por defecto).',
  },
};

/** A configuration mistake, in the four languages. */
export function configErrorText({ code, params }) {
  return localize(CONFIG_ERRORS[code], params);
}

export const PROBE_ERRORS = {
  plantRefused: {
    en: ({ unitId }) =>
      `the device answers but refuses the plant registers at unit id ${unitId} (247 in the protocol)`,
    fr: ({ unitId }) =>
      `l’appareil répond mais refuse les registres de l’installation à l’identifiant ${unitId} (247 dans le protocole)`,
    de: ({ unitId }) =>
      `das Gerät antwortet, lehnt aber die Register der Anlage unter der Unit-ID ${unitId} ab (247 im Protokoll)`,
    es: ({ unitId }) =>
      `el dispositivo responde pero rechaza los registros de la instalación en el identificador ${unitId} (247 en el protocolo)`,
  },
  notInverter: {
    en: ({ unitId }) => `unit id ${unitId} is not a Sigenergy inverter`,
    fr: ({ unitId }) => `l’identifiant ${unitId} n’est pas un onduleur Sigenergy`,
    de: ({ unitId }) => `die Unit-ID ${unitId} ist kein Sigenergy-Wechselrichter`,
    es: ({ unitId }) => `el identificador ${unitId} no es un inversor Sigenergy`,
  },
};

/** Thrown by a command: one text, in the language of the configuration. */
export const CONTROL_ERRORS = {
  disabled: {
    en: 'Battery control is off: allow it in the configuration of the integration first.',
    fr: 'Le pilotage de la batterie est désactivé : autorisez-le d’abord dans la configuration de l’intégration.',
    de: 'Die Batteriesteuerung ist aus: Erlaube sie zuerst in der Konfiguration der Integration.',
    es: 'El control de la batería está desactivado: permítalo primero en la configuración de la integración.',
  },
  unavailable: {
    en: 'No controllable battery was found on this system.',
    fr: 'Aucune batterie pilotable n’a été trouvée sur cette installation.',
    de: 'Auf dieser Anlage wurde keine steuerbare Batterie gefunden.',
    es: 'No se ha encontrado ninguna batería controlable en esta instalación.',
  },
  badMode: {
    en: (mode) => `Unknown battery mode "${mode}".`,
    fr: (mode) => `Mode de batterie inconnu « ${mode} ».`,
    de: (mode) => `Unbekannter Batteriemodus „${mode}“.`,
    es: (mode) => `Modo de batería desconocido «${mode}».`,
  },
  badLimit: {
    en: (value, max) => `The limit ${value} W is not a number from 0 to ${max} W (rated power).`,
    fr: (value, max) =>
      `La limite ${value} W n’est pas un nombre de 0 à ${max} W (puissance nominale).`,
    de: (value, max) => `Die Grenze ${value} W ist keine Zahl von 0 bis ${max} W (Nennleistung).`,
    es: (value, max) => `El límite ${value} W no es un número de 0 a ${max} W (potencia nominal).`,
  },
  noLimit: {
    en: 'Give a charge limit, a discharge limit, or both.',
    fr: 'Indiquez une limite de charge, de décharge, ou les deux.',
    de: 'Gib eine Lade- oder eine Entladegrenze an, oder beide.',
    es: 'Indique un límite de carga, de descarga o ambos.',
  },
  failed: {
    en: (error) => `The Sigenergy system refused the command: ${error}.`,
    fr: (error) => `L’installation Sigenergy a refusé la commande : ${error}.`,
    de: (error) => `Die Sigenergy-Anlage hat den Befehl abgelehnt: ${error}.`,
    es: (error) => `La instalación Sigenergy ha rechazado la orden: ${error}.`,
  },
};

/** What a command did, shown in a toast or under a button. */
export const CONTROL_DONE = {
  mode: {
    en: (label) => `Battery mode: ${label}.`,
    fr: (label) => `Mode de la batterie : ${label}.`,
    de: (label) => `Batteriemodus: ${label}.`,
    es: (label) => `Modo de la batería: ${label}.`,
  },
  limits: {
    en: (text) => `Battery limits: ${text}.`,
    fr: (text) => `Limites de la batterie : ${text}.`,
    de: (text) => `Batteriegrenzen: ${text}.`,
    es: (text) => `Límites de la batería: ${text}.`,
  },
  charge: { en: 'charge', fr: 'charge', de: 'Laden', es: 'carga' },
  discharge: { en: 'discharge', fr: 'décharge', de: 'Entladen', es: 'descarga' },
};
