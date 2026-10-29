import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { publicErrorMessage, redactHomePath } from '../src/errors.js';

test('redacts the home directory in paths and embedded error messages', () => {
  const home = homedir();
  const file = join(home, 'images', 'image.png');
  assert.equal(redactHomePath(home), '~');
  assert.equal(redactHomePath(file), `~${sep}images${sep}image.png`);
  assert.equal(publicErrorMessage(new Error(`Image file does not exist: ${file}`)),
    `Image file does not exist: ~${sep}images${sep}image.png`);
  assert.equal(redactHomePath(`Failed to read '${file}'; home="${home}"`),
    `Failed to read '~${sep}images${sep}image.png'; home="~"`);
});

test('redacts local file URLs while preserving ordinary HTTP URLs', () => {
  const home = homedir();
  assert.equal(redactHomePath(`Cannot read ${pathToFileURL(join(home, 'image with space.png')).href}`),
    'Cannot read file://~/image%20with%20space.png');
  assert.equal(redactHomePath(pathToFileURL(home).href), 'file://~');
  const remote = `https://example.test${home.replaceAll('\\', '/')}/image.png`;
  assert.equal(redactHomePath(remote), remote);
});

test('preserves similar directory prefixes and unrelated nested paths', () => {
  const home = homedir();
  for (const suffix of ['2', '-other', '_other', '.backup']) {
    const path = `${home}${suffix}${sep}image.png`;
    assert.equal(redactHomePath(path), path);
  }
  const nested = `/archive${home.replaceAll('\\', '/')}/image.png`;
  assert.equal(redactHomePath(nested), nested);
});

test('handles non-Error values and multiple path references', () => {
  assert.equal(publicErrorMessage(null), 'null');
  assert.equal(publicErrorMessage('plain message'), 'plain message');
  const home = homedir();
  assert.equal(publicErrorMessage(`Paths: ${home}${sep}a.png, ${home}${sep}b.png`),
    `Paths: ~${sep}a.png, ~${sep}b.png`);
});
