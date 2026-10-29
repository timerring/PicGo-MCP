#!/usr/bin/env node
import { Console } from 'node:console';
import { parseArgs } from 'node:util';

async function main() {
  const { values } = parseArgs({
    options: {
      config: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.config !== undefined && values.config.trim().length === 0) {
    throw new Error('--config requires a non-empty file path.');
  }
  if (values.help) {
    process.stdout.write(`picgo-mcp — use PicGo Core as an MCP stdio server

Usage: picgo-mcp [--config /path/to/config.json]

Options:
  --config PATH  PicGo data.json/config.json path
  -h, --help     Show this help

Environment:
  PICGO_CONFIG_PATH  Alternative way to select the PicGo config file
`);
    return;
  }

  // Route dependency and plugin console output to stderr before loading them.
  // The MCP transport owns stdout for JSON-RPC messages.
  globalThis.console = new Console({ stdout: process.stderr, stderr: process.stderr });
  const [{ StdioServerTransport }, { resolveConfigPath }, { PicGoService }, { createServer }] = await Promise.all([
    import('@modelcontextprotocol/sdk/server/stdio.js'),
    import('./config.js'),
    import('./picgo-service.js'),
    import('./server.js'),
  ]);
  const resolution = resolveConfigPath(values.config);
  const server = createServer(new PicGoService(resolution));
  const transport = new StdioServerTransport();

  async function shutdown() {
    await server.close();
    process.exit(0);
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  await server.connect(transport);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`Failed to start picgo-mcp: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
}
