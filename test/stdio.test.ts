import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entryPoint = resolve(projectRoot, 'dist/index.js');

test('stdio keeps PicGo and plugin logs on stderr throughout startup and upload', { timeout: 15000 }, async () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'picgo-mcp-stdio-'));
  const configPath = resolve(directory, 'config.json');
  const imagePath = resolve(directory, 'image.png');
  const pluginName = 'picgo-plugin-stdio-fixture';
  const pluginPath = resolve(directory, 'node_modules', pluginName);
  mkdirSync(pluginPath, { recursive: true });
  writeFileSync(resolve(directory, 'package.json'), JSON.stringify({ dependencies: { [pluginName]: '1.0.0' } }));
  writeFileSync(resolve(pluginPath, 'package.json'), JSON.stringify({ name: pluginName, version: '1.0.0', main: 'index.js' }));
  writeFileSync(resolve(pluginPath, 'index.js'), `
console.log('fixture module loaded');
module.exports = (ctx) => {
  console.info('fixture instantiated');
  return {
    register() {
      console.log('fixture registered');
      ctx.helper.uploader.register('stdio-fixture', {
        async handle(context) {
          console.log('fixture upload called');
          context.log.info('fixture PicGo logger called');
          for (const image of context.output) image.imgUrl = 'https://example.test/image.png';
          return context;
        }
      });
    }
  };
};
`);
  writeFileSync(configPath, JSON.stringify({
    picBed: { uploader: 'stdio-fixture', current: 'stdio-fixture' },
    picgoPlugins: { [pluginName]: true },
  }));
  writeFileSync(imagePath, Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGZkAAAAASUVORK5CYII=',
    'base64',
  ));

  const client = new Client({ name: 'stdio-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entryPoint, '--config', configPath],
    cwd: projectRoot,
    stderr: 'pipe',
  });
  const protocolErrors: Error[] = [];
  let stderr = '';
  client.onerror = (error) => { protocolErrors.push(error); };
  transport.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

  try {
    await client.connect(transport);
    const status = await client.callTool({ name: 'get_picgo_status', arguments: {} });
    assert.equal(status.isError, undefined);
    const result = await client.callTool({ name: 'upload_image', arguments: { source: imagePath } });
    assert.equal(result.isError, undefined);
    const content = result.content as Array<{ type: string; text: string }>;
    const payload = JSON.parse(content[0].text);
    assert.equal(payload.images[0].url, 'https://example.test/image.png');
  } finally {
    await client.close();
    rmSync(directory, { recursive: true, force: true });
  }

  assert.deepEqual(protocolErrors, []);
  for (const message of [
    'fixture module loaded',
    'fixture instantiated',
    'fixture registered',
    'fixture upload called',
    'fixture PicGo logger called',
  ]) {
    assert.ok(stderr.includes(message), `Expected stderr to include: ${message}`);
  }
});

test('CLI rejects incomplete or unknown options before starting the server', () => {
  for (const args of [['--config'], ['--config='], ['--config', '--unknown'], ['--unknown']]) {
    const result = spawnSync(process.execPath, [entryPoint, ...args], {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /--config|--unknown/);
  }
});
