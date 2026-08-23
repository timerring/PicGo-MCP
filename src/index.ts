#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolveConfigPath } from './config.js';
import { PicGoService } from './picgo-service.js';
import { createServer } from './server.js';

function argumentValue(name: string): string | undefined {
  const exactIndex = process.argv.indexOf(name);
  if (exactIndex >= 0) return process.argv[exactIndex + 1];
  const prefix = `${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(`picgo-mcp — use PicGo Core as an MCP stdio server

Usage: picgo-mcp [--config /path/to/config.json]

Options:
  --config PATH  PicGo data.json/config.json path
  -h, --help     Show this help

Environment:
  PICGO_CONFIG_PATH  Alternative way to select the PicGo config file
`);
  process.exit(0);
}

const resolution = resolveConfigPath(argumentValue('--config'));
const server = createServer(new PicGoService(resolution));
const transport = new StdioServerTransport();

process.on('SIGINT', async () => {
  await server.close();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  await server.close();
  process.exit(0);
});

try {
  await server.connect(transport);
} catch (error) {
  process.stderr.write(`Failed to start picgo-mcp: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
}
