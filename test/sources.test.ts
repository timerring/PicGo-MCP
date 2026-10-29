import assert from 'node:assert/strict';
import fs, { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { normalizeSource } from '../src/sources.js';

const directory = mkdtempSync(join(tmpdir(), 'picgo-sources-test-'));
const file = join(directory, 'image with space.png');
writeFileSync(file, 'test fixture');
after(() => rmSync(directory, { recursive: true, force: true }));

test('normalizes local files, relative paths and file URLs', () => {
  assert.equal(normalizeSource(file), file);
  assert.equal(normalizeSource(pathToFileURL(file).href), file);
  const previousDirectory = process.cwd();
  try {
    // The checkout and system temp directory can be on different Windows drives.
    process.chdir(directory);
    const relativePath = relative(process.cwd(), file);
    assert.equal(isAbsolute(relativePath), false);
    assert.equal(normalizeSource(relativePath), file);
  } finally {
    process.chdir(previousDirectory);
  }
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

test('treats Windows drive and UNC paths as file sources', (t) => {
  const sources = [
    'C:\\picgo-mcp-missing-392dff92\\image.png',
    'C:/picgo-mcp-missing-392dff92/image.png',
    '\\\\picgo-mcp-missing-392dff92\\share\\image.png',
  ];
  const fileStat = fs.statSync(file);
  const exists = t.mock.method(fs, 'existsSync', () => true);
  const stat = t.mock.method(fs, 'statSync', () => fileStat);
  syncBuiltinESMExports();
  try {
    for (const source of sources) assert.equal(normalizeSource(source), source);
    assert.deepEqual(exists.mock.calls.map(call => call.arguments[0]), sources);
    assert.deepEqual(stat.mock.calls.map(call => call.arguments[0]), sources);

    exists.mock.mockImplementation(() => false);
    for (const source of sources) {
      assert.throws(() => normalizeSource(source), { message: `Image file does not exist: ${source}` });
    }
    assert.equal(stat.mock.callCount(), sources.length);
  } finally {
    exists.mock.restore();
    stat.mock.restore();
    syncBuiltinESMExports();
  }
});

test('accepts HTTP URLs and rejects empty input and other protocols', () => {
  assert.equal(normalizeSource(' HTTPS://example.test/image.png '), 'https://example.test/image.png');
  assert.equal(normalizeSource('http://example.test/image.png?size=1'), 'http://example.test/image.png?size=1');
  assert.throws(() => normalizeSource('   '), /Image source cannot be empty/);
  assert.throws(() => normalizeSource('ftp://example.test/image.png'), /Unsupported image source protocol: ftp/);
});
