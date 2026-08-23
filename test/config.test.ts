import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { resolve } from 'node:path';
import { resolveConfigPath } from '../src/config.js';

const originalConfigPath = process.env.PICGO_CONFIG_PATH;

afterEach(() => {
  if (originalConfigPath === undefined) delete process.env.PICGO_CONFIG_PATH;
  else process.env.PICGO_CONFIG_PATH = originalConfigPath;
});
test('explicit config takes precedence over the environment', () => {
  process.env.PICGO_CONFIG_PATH = '/tmp/from-environment.json';
  const result = resolveConfigPath('./custom.json');
  assert.equal(result.configPath, resolve('./custom.json'));
  assert.equal(result.source, 'argument');
});

test('PICGO_CONFIG_PATH is supported', () => {
  process.env.PICGO_CONFIG_PATH = '/tmp/picgo-test-config.json';
  const result = resolveConfigPath();
  assert.equal(result.configPath, '/tmp/picgo-test-config.json');
  assert.equal(result.source, 'environment');
  assert.equal(result.exists, false);
});
