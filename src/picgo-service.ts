import { existsSync, readFileSync } from 'node:fs';
import { PicGo, type IConfig, type IImgInfo } from 'picgo';
import type { ConfigResolution } from './config.js';
import { publicErrorMessage, redactHomePath } from './errors.js';
import { normalizeSource } from './sources.js';
import { renderOutput, renderUploadName, validateOutputTemplate } from './templates.js';

export interface UploadedImage {
  sourceIndex: number;
  url: string;
  originalUrl?: string;
  fileName?: string;
  width?: number;
  height?: number;
  size?: number;
}

export interface UploadResult {
  index: number;
  source: string;
  status: 'success' | 'error';
  error?: string;
}

export interface UploadBatchResult {
  images: UploadedImage[];
  results: UploadResult[];
  formattedOutput: string;
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

function toUploadedImage(image: IImgInfo, sourceIndex: number): UploadedImage {
  return {
    sourceIndex,
    url: image.imgUrl!,
    ...(image.originImgUrl ? { originalUrl: image.originImgUrl } : {}),
    ...(image.fileName ? { fileName: image.fileName } : {}),
    ...(image.width !== undefined ? { width: image.width } : {}),
    ...(image.height !== undefined ? { height: image.height } : {}),
    ...(image.size !== undefined ? { size: image.size } : {}),
  };
}

export class PicGoService {
  private picgo?: PicGo;
  private configSnapshot?: string;
  private queue: Promise<void> = Promise.resolve();
  private uploadContext?: {
    index: number;
    count: number;
    now: Date;
    nameTemplate?: string;
    lifecycle?: { output: IImgInfo[] };
  };

  constructor(private readonly resolution: ConfigResolution) {}

  private async serialized<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private getPicGo(): PicGo {
    if (!existsSync(this.resolution.configPath)) {
      throw new Error(
        `PicGo configuration was not found. Looked in: ${this.resolution.searchedPaths.map(redactHomePath).join(', ')}. ` +
          'Pass --config /path/to/config.json or set PICGO_CONFIG_PATH.',
      );
    }
    const snapshot = readFileSync(this.resolution.configPath, 'utf8');
    if (this.picgo && snapshot !== this.configSnapshot) {
      throw new Error('PicGo configuration changed. Restart the MCP connection to load the updated settings.');
    }
    if (!this.picgo) {
      const picgo = new PicGo(this.resolution.configPath);
      picgo.helper.beforeUploadPlugins.register('picgoMcpUploadName', {
        handle: (ctx) => {
          const context = this.uploadContext;
          if (!context) return;
          // PicGo runs hooks and uploaders on a separate lifecycle context.
          context.lifecycle = ctx;
          if (!context.nameTemplate) return;
          for (const image of ctx.output) {
            image.fileName = renderUploadName(
              context.nameTemplate, image.fileName ?? '', context.index, context.count, context.now,
            );
          }
        },
      });
      // PicGo can migrate the file while constructing the instance.
      this.configSnapshot = readFileSync(this.resolution.configPath, 'utf8');
      this.picgo = picgo;
    }
    return this.picgo;
  }

  async status(): Promise<PicGoStatus> {
    return this.serialized(() => {
      const configExists = existsSync(this.resolution.configPath);
      const common = {
        configPath: redactHomePath(this.resolution.configPath),
        configExists,
        configSource: this.resolution.source,
        searchedPaths: this.resolution.searchedPaths.map(redactHomePath),
      };
      if (!configExists) {
        return { ...common, uploaderConfigured: false, configuredFields: [], availableUploaders: [] };
      }

      const picgo = this.getPicGo();
      const config = picgo.getConfig<IConfig>();
      const uploader = config.picBed?.uploader;
      const current = config.picBed?.current;
      const activeConfig = uploader ? picgo.uploaderConfig.getActiveConfig(uploader) : undefined;
      const uploaderConfig = activeConfig ?? (uploader ? config.picBed?.[uploader] : undefined);
      const configuredFields = uploaderConfig && typeof uploaderConfig === 'object'
        ? Object.keys(uploaderConfig).filter((key) => !METADATA_FIELDS.has(key)).sort()
        : [];

      return {
        ...common,
        picgoVersion: picgo.VERSION,
        uploader,
        current,
        uploaderConfigured: configuredFields.length > 0,
        configuredFields,
        availableUploaders: picgo.uploaderConfig.listUploaderTypes().sort(),
      };
    });
  }

  async upload(sources: string[]): Promise<UploadBatchResult> {
    return this.serialized(async () => {
      if (sources.length < 1 || sources.length > 20) {
        throw new Error('Provide between 1 and 20 image sources.');
      }
      const picgo = this.getPicGo();
      const outputTemplate = picgo.getConfig<string>('settings.picgoMcp.outputFormat') ??
        picgo.getConfig<string>('customOutputFormat') ?? '${url}';
      const nameTemplate = picgo.getConfig<string>('settings.picgoMcp.uploadNameTemplate') ??
        picgo.getConfig<string>('customUploadName');
      const now = new Date();
      // Validate settings before any remote side effect.
      validateOutputTemplate(outputTemplate);
      if (nameTemplate !== undefined && nameTemplate !== '') {
        renderUploadName(nameTemplate, 'image.png', 0, sources.length, now);
      }

      const images: UploadedImage[] = [];
      const results: UploadResult[] = [];
      try {
        for (const [index, source] of sources.entries()) {
          this.uploadContext = { index, count: sources.length, now, nameTemplate };
          let output: IImgInfo[] = [];
          let failure: unknown;
          let failed = false;
          // One input per lifecycle preserves identity when a transformer filters failures.
          picgo.output = [];
          try {
            const normalized = normalizeSource(source);
            const uploaded = await picgo.upload([normalized]);
            if (uploaded instanceof Error) throw uploaded;
            output = Array.isArray(uploaded) ? uploaded : [];
          } catch (error) {
            failed = true;
            failure = error;
            output = this.uploadContext.lifecycle?.output ?? picgo.output;
          }
          const completed = output.filter((image) => image.imgUrl);
          images.push(...completed.map((image) => toUploadedImage(image, index)));
          if (failed || completed.length === 0 || completed.length !== output.length) {
            results.push({
              index,
              source: redactHomePath(source),
              status: 'error',
              error: publicErrorMessage(failure ?? new Error(
                'PicGo returned incomplete upload results. Review the successful images before retrying this source.',
              )),
            });
          } else {
            results.push({ index, source: redactHomePath(source), status: 'success' });
          }
        }
      } finally {
        this.uploadContext = undefined;
      }
      return {
        images,
        results,
        formattedOutput: images.map((image) => renderOutput(outputTemplate, image.url, image.fileName ?? 'image')).join('\n'),
      };
    });
  }
}
