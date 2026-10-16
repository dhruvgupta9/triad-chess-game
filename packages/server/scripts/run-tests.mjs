import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Expand paths ourselves: Node 20 and Windows shells do not expand quoted globs.
const directory = new URL('../dist/test/', import.meta.url);
const files = readdirSync(directory).filter((name) => name.endsWith('.test.js')).sort()
  .map((name) => fileURLToPath(new URL(name, directory)));
if (!files.length) throw new Error('No compiled server tests found. Run the server build first.');
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
