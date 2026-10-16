# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-16

### Added

- Sigenergy systems (SigenStor, Sigen Hybrid) read on the local network in
  Modbus TCP, with the registers of the official Sigenergy Modbus Protocol
  V2.9: no register to declare.
- A device for the system: solar power, home consumption, grid exchange
  (import and export), battery level, charge and discharge power, energy
  available, battery health, cumulative indexes (solar, home, grid import and
  export, battery charged and discharged), operating mode, state, off-grid
  operation and translated alarms.
- A device per inverter (up to 8): power, solar power, battery, temperatures,
  phase voltages and currents, each PV string, state and alarms.
- Energy tracking (Gladys 5.2): the home consumption and the solar production
  are published as indexes.
- Battery control, off by default: battery mode (automatic, forced charge or
  discharge, standby) and charge and discharge power limits, from the device,
  the widget and two scene actions.
- The "Sigenergy energy" dashboard widget: solar, home, grid and battery live,
  with the mode and the alarms.
- Scene triggers: a new alarm (with its text), the system stops answering,
  answers again.
- The "Test the connection" button, which also looks for the inverter unit
  ids.
- English, French, German and Spanish everywhere.

[Unreleased]: https://github.com/guim31/gladys-sigenergy/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-sigenergy/releases/tag/v1.0.1
