import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PicGo, type IConfig, type IImgInfo } from 'picgo';
import type { ConfigResolution } from './config.js';
import { renderOutput, renderUploadName } from './templates.js';

export interface UploadedImage {
  url: string;
  originalUrl?: string;
  fileName?: string;
  width?: number;
  height?: number;
  size?: number;
}

export interface PicGoStatus {
  configPath: string;
  configExists: boolean;
  configSource: ConfigResolution['source'];
  searchedPaths: string[];
  picgoVersion?: string;
  uploader?: string;
  current?: string;
  uploaderConfigured: boolean;
  configuredFields: string[];
  availableUploaders: string[];
}

const METADATA_FIELDS = new Set(['_id', '_configName', '_createdAt', '_updatedAt']);

function redactHomePath(filePath: string): string {
  const home = homedir();
  if (filePath === home) return '~';
  if (filePath.startsWith(`${home}${sep}`)) return `~${filePath.slice(home.length)}`;
  return filePath;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeSource(source: string): string {
  const value = source.trim();
  if (!value) throw new Error('Image source cannot be empty.');

  if (/^https?:\/\//i.test(value)) return value;
  if (/^file:\/\//i.test(value)) return fileURLToPath(value);
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) {
    throw new Error(`Unsupported image source protocol: ${value.split(':', 1)[0]}`);
  }

  const filePath = isAbsolute(value) ? value : resolve(value);
  if (!existsSync(filePath)) throw new Error(`Image file does not exist: ${filePath}`);
  if (!statSync(filePath).isFile()) throw new Error(`Image source is not a file: ${filePath}`);
  return filePath;
}

function toUploadedImage(image: IImgInfo, index: number): UploadedImage {
  if (!image.imgUrl) throw new Error(`PicGo returned no URL for uploaded image #${index + 1}.`);
  return {
    url: image.imgUrl,
    ...(image.originImgUrl ? { originalUrl: image.originImgUrl } : {}),
    ...(image.fileName ? { fileName: image.fileName } : {}),
    ...(image.width !== undefined ? { width: image.width } : {}),
    ...(image.height !== undefined ? { height: image.height } : {}),
    ...(image.size !== undefined ? { size: image.size } : {}),
  };
}

export class PicGoService {
  private picgo?: PicGo;
  private uploadQueue: Promise<void> = Promise.resolve();

  constructor(private readonly resolution: ConfigResolution) {}

  private getPicGo(): PicGo {
    if (!existsSync(this.resolution.configPath)) {
      throw new Error(
        `PicGo configuration was not found. Looked in: ${this.resolution.searchedPaths.map(redactHomePath).join(', ')}. ` +
          'Pass --config /path/to/config.json or set PICGO_CONFIG_PATH.',
      );
    }
    if (!this.picgo) {
      this.picgo = new PicGo(this.resolution.configPath);
      this.picgo.helper.beforeUploadPlugins.register('picgoMcpUploadName', {
        handle: (ctx) => {
          const template =
            ctx.getConfig<string>('settings.picgoMcp.uploadNameTemplate') ??
            ctx.getConfig<string>('customUploadName');
          if (!template) return;
          const now = new Date();
          ctx.output.forEach((image, index, images) => {
            image.fileName = renderUploadName(template, image.fileName ?? '', index, images.length, now);
          });
        },
      });
    }
    return this.picgo;
  }

  formatOutput(images: UploadedImage[]): string {
    const picgo = this.getPicGo();
    const template =
      picgo.getConfig<string>('settings.picgoMcp.outputFormat') ??
      picgo.getConfig<string>('customOutputFormat') ??
      '${url}';
    return images.map((image) => renderOutput(template, image.url, image.fileName ?? 'image')).join('\n');
  }

  status(): PicGoStatus {
    const configExists = existsSync(this.resolution.configPath);
    const publicConfigPath = redactHomePath(this.resolution.configPath);
    const publicSearchedPaths = this.resolution.searchedPaths.map(redactHomePath);
    if (!configExists) {
      return {
        configPath: publicConfigPath,
        configExists: false,
        configSource: this.resolution.source,
        searchedPaths: publicSearchedPaths,
        uploaderConfigured: false,
        configuredFields: [],
        availableUploaders: [],
      };
    }

    const picgo = this.getPicGo();
    const config = picgo.getConfig<IConfig>();
    const uploader = config.picBed?.uploader;
    const current = config.picBed?.current;
    const activeConfig = uploader ? picgo.uploaderConfig.getActiveConfig(uploader) : undefined;
    const legacyConfig = uploader ? config.picBed?.[uploader] : undefined;
    const uploaderConfig = activeConfig ?? legacyConfig;
    const configuredFields =
      uploaderConfig && typeof uploaderConfig === 'object'
        ? Object.keys(uploaderConfig).filter((key) => !METADATA_FIELDS.has(key)).sort()
        : [];

    return {
      configPath: publicConfigPath,
      configExists: true,
      configSource: this.resolution.source,
      searchedPaths: publicSearchedPaths,
      picgoVersion: picgo.VERSION,
      uploader,
      current,
      uploaderConfigured: configuredFields.length > 0,
      configuredFields,
      availableUploaders: picgo.uploaderConfig.listUploaderTypes().sort(),
    };
  }

  async upload(sources: string[]): Promise<UploadedImage[]> {
    const normalized = sources.map(normalizeSource);

    // PicGo keeps input/output as mutable instance state, so serialize calls made by concurrent MCP clients.
    const previous = this.uploadQueue;
    let release!: () => void;
    this.uploadQueue = new Promise<void>((resolveQueue) => {
      release = resolveQueue;
    });
    await previous;

    try {
      const picgo = this.getPicGo();
      const result = await picgo.upload(normalized);
      if (result instanceof Error) throw result;
      if (!Array.isArray(result) || result.length === 0) {
        throw new Error('PicGo did not return any uploaded images. Check the uploader configuration and PicGo logs.');
      }
      return result.map(toUploadedImage);
    } catch (error) {
      throw new Error(`PicGo upload failed: ${errorMessage(error)}`, { cause: error });
    } finally {
      release();
    }
  }
}
