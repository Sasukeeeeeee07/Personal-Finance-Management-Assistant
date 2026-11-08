// Regenerates docs/api/openapi-v1.json from the running code. Cross-platform (no shell env syntax).
const { spawnSync } = require('child_process');
const result = spawnSync(process.execPath, ['--experimental-vm-modules', 'node_modules/jest/bin/jest.js', '--runInBand', 'test/api-contract'], {
  stdio: 'inherit',
  env: { ...process.env, OPENAPI_FREEZE: '1' },
});
process.exit(result.status ?? 1);
