import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { resolveConfigPath } from '../src/config.js';

const originalConfigPath = process.env.PICGO_CONFIG_PATH;

afterEach(() => {
  if (originalConfigPath === undefined) delete process.env.PICGO_CONFIG_PATH;
  else process.env.PICGO_CONFIG_PATH = originalConfigPath;
});
test('explicit config takes precedence over the environment', () => {
  process.env.PICGO_CONFIG_PATH = resolve(tmpdir(), 'from-environment.json');
  const result = resolveConfigPath('./custom.json');
  assert.equal(result.configPath, resolve('./custom.json'));
  assert.equal(result.source, 'argument');
});

test('PICGO_CONFIG_PATH is supported', () => {
  const configPath = resolve(tmpdir(), 'picgo-test-config.json');
  process.env.PICGO_CONFIG_PATH = configPath;
  const result = resolveConfigPath();
  assert.equal(result.configPath, configPath);
  assert.equal(result.source, 'environment');
});
