#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Read-only probe of a real Sigenergy system, with the integration's own
// client, register map and features: what the integration would publish,
// feature by feature. It never writes (no function 6 or 16 is sent).
//
//   node scripts/probe.mjs <ip> [--port 502] [--units 1,2] [--plant 247] [--timeout 3]
//
// Without --units, it looks for inverters at unit ids 1 to 16. The serial
// numbers are masked in the output.
// -----------------------------------------------------------------------------

import { parseArgs } from 'node:util';
import { ModbusConnection } from '../src/modbus/connection.js';
import { BlockReader } from '../src/modbus/reader.js';
import { inverterFeatures, inverterRegister, plantFeatures, plantRegister } from '../src/model.js';
import { featureName } from '../src/names.js';
import { READ_OPTIONS, probeInverter, probePlant } from '../src/probe.js';
import { decode, point } from '../src/sigenergy/registers.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: 'string', default: '502' },
    units: { type: 'string', default: '' },
    plant: { type: 'string', default: '247' },
    timeout: { type: 'string', default: '3' },
    language: { type: 'string', default: 'en' },
  },
});

const host = positionals[0];
if (!host) {
  console.error('Usage: node scripts/probe.mjs <ip> [--port 502] [--units 1,2] [--plant 247]');
  process.exit(2);
}

const mask = (serial) => (serial ? `…${String(serial).slice(-4)}` : serial);
const connection = new ModbusConnection({
  host,
  port: Number(values.port),
  timeoutMs: Number(values.timeout) * 1000,
});
const plantUnit = Number(values.plant);

async function show(label, unitId, features, registerOf) {
  const names = [...new Set(features.flatMap((feature) => feature.registers))];
  const started = Date.now();
  const results = await new BlockReader().readPoints(
    connection,
    unitId,
    names.map((name) => point(name, registerOf(name))),
    READ_OPTIONS,
  );
  const registers = Object.fromEntries(
    names.map((name) => {
      const words = results.get(name);
      return [name, Array.isArray(words) ? decode(registerOf(name), words) : undefined];
    }),
  );
  console.log(`\n${label} (unit ${unitId}), read in ${Date.now() - started} ms:`);
  for (const feature of features) {
    let value = feature.value(registers, { lang: values.language });
    if (value && typeof value === 'object') {
      value = value.text;
    }
    const unit = feature.unit ? ` ${feature.unit}` : '';
    console.log(
      `  ${featureName(feature.name, values.language, feature.n).padEnd(34)} ${value ?? '—'}${value === undefined ? '' : unit}`,
    );
  }
  const refused = names.filter((name) => !Array.isArray(results.get(name)));
  if (refused.length > 0) {
    console.log(`  refused registers: ${refused.join(', ')}`);
  }
}

try {
  const unitIds = values.units
    ? values.units
        .split(/[\s,;]+/)
        .filter(Boolean)
        .map(Number)
    : Array.from({ length: 16 }, (_, i) => i + 1);
  const inverters = [];
  for (const unitId of unitIds) {
    try {
      const layout = await probeInverter(connection, unitId);
      inverters.push(layout);
      console.log(
        `Inverter ${unitId}: ${JSON.stringify({ ...layout, serial: mask(layout.serial), supported: layout.supported.length })}`,
      );
    } catch (err) {
      if (values.units) {
        console.log(`Inverter ${unitId}: ${err.message}`);
      }
    }
  }
  const platformId = inverters[0] ? `plant-${mask(inverters[0].serial)}` : null;
  const plant = await probePlant(connection, plantUnit, platformId);
  console.log(
    `Plant ${plantUnit}: ${JSON.stringify({ ...plant, supported: plant.supported.length, platformId: undefined })}`,
  );
  plant.hasBattery = plant.hasBattery || inverters.some((inverter) => inverter.hasBattery);
  await show('Plant', plantUnit, plantFeatures(plant, { control: true }), plantRegister);
  for (const inverter of inverters) {
    await show(
      `Inverter ${inverter.model}`,
      inverter.unitId,
      inverterFeatures(inverter),
      inverterRegister,
    );
  }
} catch (err) {
  console.error(`Probe failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  connection.close();
}
