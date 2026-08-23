import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { after, test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { PicGoService } from '../src/picgo-service.js';
import { createServer } from '../src/server.js';

const temporaryDirectory = mkdtempSync(resolve(tmpdir(), 'picgo-mcp-test-'));
const configPath = resolve(temporaryDirectory, 'config.json');
writeFileSync(configPath, JSON.stringify({ picBed: { uploader: 'smms', current: 'smms' }, picgoPlugins: {} }));

after(() => rmSync(temporaryDirectory, { recursive: true, force: true }));

test('status reports metadata without returning secret values', () => {
  const service = new PicGoService({
    configPath,
    exists: true,
    searchedPaths: [configPath],
    source: 'argument',
  });
  const status = service.status();
  assert.equal(status.picgoVersion, '3.0.1');
  assert.equal(status.uploader, 'smms');
  assert.equal(status.uploaderConfigured, false);
  assert.ok(status.availableUploaders.includes('smms'));
  assert.equal(JSON.stringify(status).includes('token'), false);
});

test('status redacts the local home directory from config paths', () => {
  const privatePath = resolve(homedir(), '.picgo/nonexistent-private-test.json');
  const service = new PicGoService({
    configPath: privatePath,
    exists: false,
    searchedPaths: [privatePath],
    source: 'argument',
  });
  const status = service.status();
  assert.equal(status.configPath, '~/.picgo/nonexistent-private-test.json');
  assert.deepEqual(status.searchedPaths, ['~/.picgo/nonexistent-private-test.json']);
  assert.equal(JSON.stringify(status).includes(homedir()), false);
});

test('MCP server exposes the expected tools and serves status', async () => {
  const service = new PicGoService({
    configPath,
    exists: true,
    searchedPaths: [configPath],
    source: 'argument',
  });
  const server = createServer(service);
  const client = new Client({ name: 'picgo-mcp-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  try {
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map((tool) => tool.name).sort(),
      ['get_picgo_status', 'upload_image', 'upload_images'],
    );

    const result = await client.callTool({ name: 'get_picgo_status', arguments: {} });
    assert.equal(result.isError, undefined);
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    assert.match(text, /"uploader": "smms"/);
  } finally {
    await client.close();
    await server.close();
  }
});

test('upload rejects a missing local file before invoking PicGo', async () => {
  const service = new PicGoService({
    configPath,
    exists: true,
    searchedPaths: [configPath],
    source: 'argument',
  });
  await assert.rejects(() => service.upload(['/definitely/not/a/picture.png']), /does not exist/);
});
