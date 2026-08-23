import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function filesBelow(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap((entry) => filesBelow(resolve(path, entry)));
}

test('publishable files contain no absolute user-home paths', () => {
  const publishablePaths = ['LICENSE', 'README.md', 'package.json', 'dist'].flatMap((entry) =>
    filesBelow(resolve(projectRoot, entry)),
  );
  const unixHomePattern = /\/(?:Users|home)\/[^/\s"']+/g;
  const windowsHomePattern = /[A-Za-z]:\\Users\\[^\\\s"']+/g;

  for (const filePath of publishablePaths) {
    const contents = readFileSync(filePath, 'utf8');
    assert.equal(contents.match(unixHomePattern), null, `Absolute Unix home path found in ${filePath}`);
    assert.equal(contents.match(windowsHomePattern), null, `Absolute Windows home path found in ${filePath}`);
  }
});

test('package metadata contains no personal identity fields', () => {
  const packageJson = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8')) as Record<string, unknown>;
  for (const field of ['author', 'contributors', 'maintainers']) {
    assert.equal(packageJson[field], undefined, `Personal package metadata field found: ${field}`);
  }
});
