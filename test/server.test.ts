import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { after, test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { PicGoService } from '../src/picgo-service.js';
import { createServer } from '../src/server.js';

const temporaryDirectory = mkdtempSync(resolve(tmpdir(), 'picgo-mcp-test-'));
const configPath = resolve(temporaryDirectory, 'config.json');
writeFileSync(configPath, JSON.stringify({ picBed: { uploader: 'smms', current: 'smms' }, picgoPlugins: {} }));

after(() => rmSync(temporaryDirectory, { recursive: true, force: true }));

test('status reports metadata without returning secret values', async () => {
  const service = new PicGoService({
    configPath,
    searchedPaths: [configPath],
    source: 'argument',
  });
  const status = await service.status();
  assert.equal(status.picgoVersion, '3.0.1');
  assert.equal(status.uploader, 'smms');
  assert.equal(status.uploaderConfigured, false);
  assert.ok(status.availableUploaders.includes('smms'));
  assert.equal(JSON.stringify(status).includes('token'), false);
});

test('status redacts the local home directory from config paths', async () => {
  const privatePath = resolve(homedir(), '.picgo/nonexistent-private-test.json');
  const service = new PicGoService({
    configPath: privatePath,
    searchedPaths: [privatePath],
    source: 'argument',
  });
  const status = await service.status();
  const publicPath = `~${sep}.picgo${sep}nonexistent-private-test.json`;
  assert.equal(status.configPath, publicPath);
  assert.deepEqual(status.searchedPaths, [publicPath]);
  assert.equal(JSON.stringify(status).includes(homedir()), false);
});

test('MCP server exposes the expected tools and serves status', async () => {
  const service = new PicGoService({
    configPath,
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
    searchedPaths: [configPath],
    source: 'argument',
  });
  const result = await service.upload([resolve(temporaryDirectory, 'missing-picture.png')]);
  assert.equal(result.results[0].status, 'error');
  assert.match(result.results[0].error!, /does not exist/);
  assert.deepEqual(result.images, []);
});

test('both upload tools return the compact payload and propagate failures', async (t) => {
  const service = new PicGoService({ configPath, searchedPaths: [configPath], source: 'argument' });
  const images = [{ sourceIndex: 0, url: 'https://example.test/image.png', fileName: 'image.png' }];
  const payload = {
    images,
    results: [{ index: 0, source: '/image.png', status: 'success' as const }],
    formattedOutput: '![image](https://example.test/image.png)',
  };
  const upload = t.mock.method(service, 'upload', async () => payload);
  const server = createServer(service);
  const client = new Client({ name: 'picgo-mcp-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  try {
    const requests = [
      { name: 'upload_image', arguments: { source: '/image.png' } },
      { name: 'upload_images', arguments: { sources: ['/image.png', '/second.png'] } },
    ];
    for (const request of requests) {
      const result = await client.callTool(request);
      assert.equal(result.isError, undefined);
      const content = result.content as Array<{ type: string; text: string }>;
      assert.deepEqual(JSON.parse(content[0].text), payload);
    }
    assert.deepEqual(upload.mock.calls.map((call) => call.arguments[0]), [
      ['/image.png'],
      ['/image.png', '/second.png'],
    ]);

    const partial = {
      ...payload,
      results: [...payload.results, { index: 1, source: '/second.png', status: 'error' as const, error: 'Upload failed' }],
    };
    upload.mock.mockImplementation(async () => partial);
    const partialResult = await client.callTool(requests[1]);
    assert.equal(partialResult.isError, true);
    const partialContent = partialResult.content as Array<{ type: string; text: string }>;
    assert.deepEqual(JSON.parse(partialContent[0].text), partial);

    upload.mock.mockImplementation(async () => { throw new Error('Upload failed'); });
    for (const request of requests) {
      const result = await client.callTool(request);
      assert.equal(result.isError, true);
      assert.deepEqual(result.content, [{ type: 'text', text: 'Upload failed' }]);
    }
  } finally {
    await client.close();
    await server.close();
  }
});
