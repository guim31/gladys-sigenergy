// -----------------------------------------------------------------------------
// scripts/probe.mjs, the read-only probe run against a real system: it reads,
// shows what Gladys would get, masks the serial numbers, and never writes.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createFakeModbusServer } from './helpers/fakeModbus.js';
import { SERIAL_SP, sigenStorSinglePhase } from './fixtures/sigenergy.js';

const run = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/probe.mjs', import.meta.url));

test('the probe script reads the system, masks the serial number and never writes', async () => {
  const server = await createFakeModbusServer({ units: sigenStorSinglePhase() });
  try {
    const { stdout } = await run(process.execPath, [
      script,
      server.host,
      '--port',
      String(server.port),
      '--units',
      '1',
    ]);
    assert.match(stdout, /Solar power\s+3210 watt/);
    assert.match(stdout, /Battery level\s+64.3 percent/);
    assert.match(stdout, /PV2 voltage\s+358 volt/);
    assert.ok(!stdout.includes(SERIAL_SP), 'the serial number is masked');
    assert.deepEqual(server.writes, []);
    assert.ok(server.requests.every((request) => [3, 4].includes(request.functionCode)));
  } finally {
    await server.close();
  }
});
