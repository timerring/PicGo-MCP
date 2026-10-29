import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function testFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return testFiles(path);
    return entry.isFile() && entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

const files = testFiles(join(root, 'test')).sort();
if (files.length === 0) throw new Error('Expected at least one .test.ts file in test/.');

const result = spawnSync(process.execPath, [
  '--test', '--import', 'tsx', ...process.argv.slice(2), ...files,
], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
