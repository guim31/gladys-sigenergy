# Sigenergy for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that reads a **Sigenergy** energy storage system — SigenStor, Sigen Hybrid and
their batteries — on the local network, in **Modbus TCP**, with the registers
of the official "Sigenergy Modbus Protocol" (V2.9). Nothing to declare
register by register: solar, home, grid and battery appear in Gladys as
devices, with the cumulative indexes of energy tracking. Battery control
(mode, charge and discharge limits) is available, and **off by default**.

> **Developed without the hardware: feedback welcome.** The integration
> follows Sigenergy's published protocol document and is tested against a
> simulated Sigenergy system built from it, not against a real one. Please
> report what works and what does not in the
> [issues](https://github.com/guim31/gladys-sigenergy/issues), with the output
> of the **Test the connection** button or of `scripts/probe.mjs`.

This project is not affiliated with Sigenergy Technology Co., Ltd.

## Features

- **The system device** (the "plant", unit 247): solar power, home
  consumption, grid exchange (signed, and split into import and export),
  battery level, charge and discharge power, energy available, battery health,
  cumulative indexes (solar production, home consumption, grid import and
  export, battery charged and discharged), operating mode, state, off-grid
  operation, alarms (every alarm bit of the protocol, translated).
- **One device per inverter** (up to 8): power, solar power, battery level,
  charge and discharge power and temperature, inverter temperature, phase
  voltages and currents (single or three phases), voltage and current of each
  PV string, state, alarms.
- **Energy tracking (Gladys 5.2)**: the home consumption is a consumption
  index, the solar production a production index; the grid and battery
  indexes use their own categories and are not counted as consumers.
- **Battery control, off by default**: battery mode (automatic = the mode of
  the mySigen app, maximum self-consumption, forced charge from the grid or
  from solar, forced discharge, standby) and charge and discharge power limits,
  from the device, the widget and scenes. Only the documented writable
  registers are written (40029, 40031, 40032, 40034).
- **Dashboard widget** "Sigenergy energy": solar, home, grid and battery live,
  the battery direction, the mode and the alarms; three mode buttons when
  control is allowed.
- **Scene triggers**: a new alarm (with its text), the system stops answering,
  answers again. **Scene actions**: set the battery mode, set the battery
  limits.
- Four languages: English, French, German, Spanish.

## Requirements

- Gladys Assistant **5.1.0** or later (widgets, scene triggers and actions);
  5.2 for energy tracking.
- A Sigenergy system reachable from the Gladys host, at a **fixed IP address**,
  with **Modbus TCP enabled** (in the mySigen app, often by the installer).
- The Modbus unit id of each inverter (1 on most systems; 2 when an AC
  charger took 1). The **Test the connection** button finds them.

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the
   address of this repository: `https://github.com/guim31/gladys-sigenergy`
   (or install **Sigenergy** from the catalog once it is listed).
2. In **Configuration**, enter the address of the system and the inverter unit
   ids. Save, then click **Test the connection**.
3. Open the **Discover** tab and add the devices.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

- A small Modbus TCP client written for this integration (`src/modbus/`, no
  dependency besides the SDK), adapted from
  [gladys-modbus](https://github.com/guim31/gladys-modbus): one connection to
  the system, one request at a time (the protocol asks to wait for each
  answer), function 4 for the running information, 3 for the parameters, 6
  and 16 for the few writes. Reads are grouped, never span a range the
  protocol marks reserved, and are split register by register when the
  firmware refuses one (exception 2: a register added in a later version of
  the protocol).
- The probe reads once what the system has (model, serial number, firmware,
  phases, PV strings, battery, rated powers, which registers the firmware
  implements) and keeps it in `/data/sigenergy-layouts.json`: a system that
  does not answer at restart is still published the same. The external ids
  come from the inverter serial numbers.
- The container reads the system by itself, at the chosen interval (10 s to
  5 min); the devices are also published with `should_poll: true` and a one
  minute `poll_frequency`, and the core's poll is a fallback, skipped when the
  timer just read (GladysAssistant/Gladys#3198).
- Only the values that changed are sent, plus each value every 6 hours; a
  cumulative index is never sent lower than before, nor at 0.
- The system is declared unreachable after two failed reads in a row: one
  warning, one scene event, one line in the connection status; its recovery
  likewise. A normal cycle logs nothing above debug.

## Checked, and what was not

- Checked by the tests (`npm test`): the frames against the examples of the
  protocol document, every data type, the grouped reads and their splits, the
  devices of two simulated systems (a single-phase SigenStor with battery on a
  recent firmware; two three-phase hybrid inverters without battery on an
  older firmware) against the category/type/unit table of the Gladys core, the
  writes (registers, values, bounds, refusals), the widget against the core
  vocabulary and budget, the logs, the four languages.
- Not checked: a real Sigenergy system and a real Gladys instance. Most worth
  checking on real hardware: the procedure to enable Modbus TCP in the app,
  the behaviour for an absent unit id, the home power of 30284 against the
  app, the read-back of the remote EMS registers (40029, 40031), and how the
  system behaves with another Modbus client connected.
  `node scripts/probe.mjs <ip>` reads a real system read-only and prints what
  the integration would publish.

## Limitations

- One Sigenergy system per integration, 8 inverters at most.
- Modbus TCP only (port 502, the system as server): no RS-485, no "TCP client"
  mode of 4G systems.
- Not read yet: AC and DC chargers, smart loads, third-party generators, PSS
  and PID devices.
- Battery commands: mode and limits only (no schedule, no power dispatch);
  limits from the device by steps of 10 % of the rated power, any value in
  watts from a scene.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
node scripts/probe.mjs 192.0.2.10 --units 1   # read-only, real system
```

The tests use the fake Gladys of the SDK (`@gladysassistant/integration-sdk/testing`)
and a fake Sigenergy system on 127.0.0.1 (`test/helpers/fakeModbus.js`,
`test/fixtures/sigenergy.js`). See [`CLAUDE.md`](CLAUDE.md) for the project
rules.

Releases go through **Actions → Release** (it bumps `package.json`, the
manifest `version` and `docker_image`, and rolls `CHANGELOG.md`). A
hand-pushed `vX.Y.Z` tag only builds the image: bump `version` in
`package.json` and in the manifest (with the `docker_image` tag) and commit it
before tagging.

## Credits

- Sigenergy Technology Co., Ltd., for publishing the "Sigenergy Modbus
  Protocol" (V2.9, 2026-05-13): the register map of this integration.
- [TypQxQ/Sigenergy-Local-Modbus](https://github.com/TypQxQ/Sigenergy-Local-Modbus)
  by Andrei Ignat and contributors (MIT), the Home Assistant integration: read
  for the pitfalls it documents (unit ids of the AC charger, registers a
  firmware lacks, lifetime counters reading 0, PV strings reading slightly
  negative, the home power source).
- The Modbus client, the fake Modbus server of the tests and the architecture
  follow [gladys-modbus](https://github.com/guim31/gladys-modbus),
  [gladys-wled](https://github.com/guim31/gladys-wled) and
  [gladys-subsonic](https://github.com/guim31/gladys-subsonic).

## Disclaimer

This project is not affiliated with, endorsed or sponsored by Sigenergy
Technology Co., Ltd. Sigenergy, SigenStor and mySigen are trademarks of their
owners.

## License

Apache-2.0
