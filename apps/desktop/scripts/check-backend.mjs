import {existsSync, statSync} from 'node:fs';
import {resolve} from 'node:path';
const name = process.platform === 'win32' ? 'bolt-service.exe' : 'bolt-service';
const backend = resolve(import.meta.dirname, '..', 'backend', name);
if (!existsSync(backend) || !statSync(backend).isFile() || statSync(backend).size < 10_000) {
  throw new Error(`Missing platform-native BOLT API binary: ${backend}. Run npm run backend:build.`);
}
console.log(`BOLT native sidecar verified: ${name}`);
