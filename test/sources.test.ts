import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { normalizeSource } from '../src/sources.js';

const directory = mkdtempSync(join(tmpdir(), 'picgo-sources-test-'));
const file = join(directory, 'image with space.png');
writeFileSync(file, 'test fixture');
after(() => rmSync(directory, { recursive: true, force: true }));

test('normalizes local files, relative paths and file URLs', () => {
  assert.equal(normalizeSource(file), file);
  assert.equal(normalizeSource(relative(process.cwd(), file)), file);
  assert.equal(normalizeSource(pathToFileURL(file).href), file);
});

test('validates file URLs with the same local file checks', () => {
  const missing = join(directory, 'missing.png');
  for (const source of [missing, pathToFileURL(missing).href]) {
    assert.throws(() => normalizeSource(source), /Image file does not exist/);
  }
  for (const source of [directory, pathToFileURL(directory).href]) {
    assert.throws(() => normalizeSource(source), /Image source is not a file/);
  }
});

test('expands home paths before file validation', () => {
  const name = 'picgo-mcp-missing-source-392dff92.png';
  for (const source of [`~/${name}`, `~\\${name}`]) {
    assert.throws(() => normalizeSource(source), {
      message: `Image file does not exist: ${join(homedir(), name)}`,
    });
  }
  assert.throws(() => normalizeSource('~'), { message: `Image source is not a file: ${homedir()}` });
});

test('treats Windows drive and UNC paths as file sources', () => {
  for (const source of [
    'C:\\picgo-mcp-missing-392dff92\\image.png',
    'C:/picgo-mcp-missing-392dff92/image.png',
    '\\\\picgo-mcp-missing-392dff92\\share\\image.png',
  ]) {
    assert.throws(() => normalizeSource(source), { message: `Image file does not exist: ${source}` });
  }
});

test('accepts HTTP URLs and rejects empty input and other protocols', () => {
  assert.equal(normalizeSource(' HTTPS://example.test/image.png '), 'https://example.test/image.png');
  assert.equal(normalizeSource('http://example.test/image.png?size=1'), 'http://example.test/image.png?size=1');
  assert.throws(() => normalizeSource('   '), /Image source cannot be empty/);
  assert.throws(() => normalizeSource('ftp://example.test/image.png'), /Unsupported image source protocol: ftp/);
});
