// Run the isolated integration suite. Never mutates the configured application database.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const result = spawnSync(process.execPath, ['--test', path.join(__dirname, '../tests/backend.test.js')], { stdio: 'inherit' });
process.exit(result.status ?? 1);

