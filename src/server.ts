import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { PicGoService, UploadedImage } from './picgo-service.js';

function jsonContent(value: unknown) {
  return [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }];
}

function uploadPayload(service: PicGoService, images: UploadedImage[]) {
  return {
    images,
    urls: images.map((image) => image.url),
    markdown: images.map((image) => `![${image.fileName ?? 'image'}](${image.url})`).join('\n'),
    formattedOutput: service.formatOutput(images),
  };
}

function toolError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true as const, content: [{ type: 'text' as const, text: message }] };
}

export function createServer(service: PicGoService): McpServer {
  const server = new McpServer({ name: 'picgo-mcp', version: '0.1.0' });

  server.registerTool(
    'upload_image',
    {
      title: 'Upload one image with PicGo',
      description: 'Upload one local image file or HTTP(S) image URL using the active PicGo uploader.',
      inputSchema: { source: z.string().min(1).describe('Local file path, file:// URL, or HTTP(S) image URL') },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ source }) => {
      try {
        const images = await service.upload([source]);
        return { content: jsonContent(uploadPayload(service, images)) };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'upload_images',
    {
      title: 'Upload multiple images with PicGo',
      description: 'Upload up to 20 local image files or HTTP(S) image URLs in one PicGo batch.',
      inputSchema: {
        sources: z
          .array(z.string().min(1))
          .min(1)
          .max(20)
          .describe('Local file paths, file:// URLs, or HTTP(S) image URLs'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ sources }) => {
      try {
        const images = await service.upload(sources);
        return { content: jsonContent(uploadPayload(service, images)) };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'get_picgo_status',
    {
      title: 'Inspect PicGo status',
      description:
        'Show the selected config path, PicGo version, active uploader, configured field names, and available uploaders. Secret values are never returned.',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return { content: jsonContent(service.status()) };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  return server;
}
