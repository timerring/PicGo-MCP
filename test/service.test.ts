import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test, type TestContext } from 'node:test';
import { PicGo, type IImgInfo } from 'picgo';
import { PicGoService } from '../src/picgo-service.js';

function fixture(t: TestContext, outputFormat = '${url}', uploadNameTemplate?: string) {
  const directory = mkdtempSync(resolve(tmpdir(), 'picgo-service-test-'));
  const configPath = resolve(directory, 'config.json');
  const writeConfig = (uploader: string, format = outputFormat) => {
    writeFileSync(configPath, JSON.stringify({
      silent: true,
      picBed: { uploader, current: uploader },
      picgoPlugins: {},
      settings: { picgoMcp: { outputFormat: format, uploadNameTemplate } },
    }));
  };
  writeConfig('github');
  t.after(async () => {
    // PicGo schedules audit-log writes on the next timers phase.
    await new Promise<void>(resolveTimers => setTimeout(resolveTimers, 0));
    rmSync(directory, { recursive: true, force: true });
  });
  const service = new PicGoService({ configPath, searchedPaths: [configPath], source: 'argument' });
  return { service, writeConfig, directory, configPath };
}

function uploaded(name: string): IImgInfo {
  return { imgUrl: `https://example.test/${name}`, fileName: name } as IImgInfo;
}

test('batch results keep successful URLs and identify failed or filtered inputs', async (t) => {
  const { service } = fixture(t);
  const calls: string[][] = [];
  t.mock.method(PicGo.prototype, 'upload', async function (this: PicGo, input: string[]) {
    calls.push(input);
    this.output = [];
    if (input[0].endsWith('/failed.png')) throw new Error('Fixture upload failure');
    if (input[0].endsWith('/filtered.png')) return [];
    this.output = [uploaded(input[0].split('/').at(-1)!)];
    return this.output;
  });
  const sources = ['first.png', 'failed.png', 'filtered.png', 'last.png'].map(name => `https://example.test/${name}`);
  const result = await service.upload(sources);

  assert.deepEqual(calls, sources.map(source => [source]));
  assert.deepEqual(result.results.map(item => ({ index: item.index, source: item.source, status: item.status })), [
    { index: 0, source: sources[0], status: 'success' },
    { index: 1, source: sources[1], status: 'error' },
    { index: 2, source: sources[2], status: 'error' },
    { index: 3, source: sources[3], status: 'success' },
  ]);
  assert.match(result.results[1].error!, /Fixture upload failure/);
  assert.ok(result.results[2].error);
  assert.deepEqual(result.images.map(image => [image.sourceIndex, image.url]), [
    [0, 'https://example.test/first.png'],
    [3, 'https://example.test/last.png'],
  ]);
  assert.equal(result.formattedOutput, 'https://example.test/first.png\nhttps://example.test/last.png');
});

test('remote sources preserve URL query parameters on success and failure', async (t) => {
  const { service } = fixture(t);
  const home = homedir().replaceAll('\\', '/');
  const sources = [
    `https://example.test/image.png?path=${home}/image.png`,
    `https://example.test/image.png?path=${home}/image.png&fail=1`,
  ];
  t.mock.method(PicGo.prototype, 'upload', async (_input: string[]) => {
    if (_input[0].endsWith('fail=1')) throw new Error('Fixture upload failure');
    return [uploaded('image.png')];
  });

  const result = await service.upload(sources);
  assert.deepEqual(result.results.map(item => item.status), ['success', 'error']);
  assert.deepEqual(result.results.map(item => item.source), sources);
});

test('an invalid output template is rejected before any upload starts', async (t) => {
  const { service } = fixture(t, '${unsupported}');
  const upload = t.mock.method(PicGo.prototype, 'upload', async () => [uploaded('image.png')]);

  await assert.rejects(service.upload(['https://example.test/image.png']), /template|expression/i);
  assert.equal(upload.mock.callCount(), 0);
});

test('config changes require a restart before status or upload can use the new settings', async (t) => {
  const { service, writeConfig, configPath } = fixture(t);
  assert.equal((await service.status()).uploader, 'github');

  writeConfig('aliyun', '![${uploadedName}](${url})');
  let usedUploader: string | undefined;
  const upload = t.mock.method(PicGo.prototype, 'upload', async function (this: PicGo) {
    usedUploader = this.getConfig<string>('picBed.uploader');
    return [uploaded('image.png')];
  });
  await assert.rejects(service.status(), /configuration changed.*Restart/);
  await assert.rejects(service.upload(['https://example.test/image.png']), /configuration changed.*Restart/);
  assert.equal(upload.mock.callCount(), 0);

  const restarted = new PicGoService({ configPath, searchedPaths: [configPath], source: 'argument' });
  const result = await restarted.upload(['https://example.test/image.png']);
  assert.equal(usedUploader, 'aliyun');
  assert.equal(result.formattedOutput, '![image](https://example.test/image.png)');
});

test('queue serializes operations and continues after an upload failure', { timeout: 5000 }, async (t) => {
  const { service } = fixture(t);
  await assert.rejects(service.upload([]), /between 1 and 20/);
  let releaseFirst!: () => void;
  let firstStarted!: () => void;
  const firstStartedPromise = new Promise<void>(resolveStarted => { firstStarted = resolveStarted; });
  const firstMayFinish = new Promise<void>(resolveFinished => { releaseFirst = resolveFinished; });
  const calls: string[] = [];
  t.mock.method(PicGo.prototype, 'upload', async function (this: PicGo, input: string[]) {
    this.output = [];
    calls.push(input[0]);
    if (calls.length === 1) {
      firstStarted();
      await firstMayFinish;
      throw new Error('First request failed');
    }
    return [uploaded('second.png')];
  });

  const first = service.upload(['https://example.test/first.png']);
  await firstStartedPromise;
  let statusFinished = false;
  const status = service.status().then(value => { statusFinished = true; return value; });
  const second = service.upload(['https://example.test/second.png']);
  await new Promise<void>(resolveTick => setImmediate(resolveTick));
  assert.equal(statusFinished, false);
  assert.equal(calls.length, 1);

  releaseFirst();
  const [firstResult, statusResult, secondResult] = await Promise.all([first, status, second]);
  assert.equal(firstResult.results[0].status, 'error');
  assert.equal(statusResult.uploader, 'github');
  assert.equal(secondResult.results[0].status, 'success');
  assert.equal(secondResult.images[0].url, 'https://example.test/second.png');
  assert.equal(calls.length, 2);
});

test('a batch uses one config snapshot even when the file changes during upload', async (t) => {
  const { service, writeConfig } = fixture(t);
  const uploaders: string[] = [];
  t.mock.method(PicGo.prototype, 'upload', async function (this: PicGo, input: string[]) {
    uploaders.push(this.getConfig<string>('picBed.uploader'));
    if (uploaders.length === 1) writeConfig('aliyun', 'changed:${url}');
    return [uploaded(input[0].split('/').at(-1)!)];
  });

  const result = await service.upload(['https://example.test/a.png', 'https://example.test/b.png']);
  assert.deepEqual(uploaders, ['github', 'github']);
  assert.equal(result.formattedOutput, 'https://example.test/a.png\nhttps://example.test/b.png');
  await assert.rejects(service.status(), /configuration changed.*Restart/);
});

test('invalid local input is reported per item and public errors redact the home path', async (t) => {
  const { service } = fixture(t);
  const missingPath = resolve(homedir(), '.picgo-service-test-missing-image.png');
  const upload = t.mock.method(PicGo.prototype, 'upload', async () => [uploaded('good.png')]);

  const result = await service.upload([missingPath, 'https://example.test/good.png']);
  assert.deepEqual(result.results.map(item => item.status), ['error', 'success']);
  assert.equal(upload.mock.callCount(), 1);
  assert.equal(JSON.stringify(result).includes(homedir()), false);
  assert.match(result.results[0].error!, /~/);
  assert.equal(result.images[0].sourceIndex, 1);
});

test('real PicGo lifecycle keeps original batch indices in file-name templates', async (t) => {
  const { service, directory } = fixture(t, '${url}', '${imgIdx}-${fileName}${extName}');
  const imagePath = resolve(directory, 'input.png');
  writeFileSync(imagePath, Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=',
    'base64',
  ));
  const originalUpload = PicGo.prototype.upload;
  t.mock.method(PicGo.prototype, 'upload', async function (this: PicGo, input: string[]) {
    if (!this.helper.uploader.get('fixture-uploader')) {
      this.helper.uploader.register('fixture-uploader', {
        handle(ctx) {
          ctx.output.forEach(image => { image.imgUrl = `https://example.test/${image.fileName}`; });
          return ctx;
        },
      });
    }
    this.setConfig({ 'picBed.uploader': 'fixture-uploader', 'picBed.current': 'fixture-uploader' });
    return originalUpload.call(this, input);
  });

  const result = await service.upload([imagePath, imagePath]);
  assert.deepEqual(result.results.map(item => item.status), ['success', 'success'], JSON.stringify(result));
  assert.deepEqual(result.images.map(image => image.fileName), ['0-input.png', '1-input.png']);
  assert.deepEqual(result.images.map(image => image.sourceIndex), [0, 1]);
});

test('real PicGo debug-mode failures preserve URLs from the lifecycle context', async (t) => {
  const { service, directory } = fixture(t);
  const imagePath = resolve(directory, 'input.png');
  writeFileSync(imagePath, Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=',
    'base64',
  ));
  const originalUpload = PicGo.prototype.upload;
  t.mock.method(PicGo.prototype, 'upload', async function (this: PicGo, input: string[]) {
    this.helper.uploader.register('fixture-partial-uploader', {
      handle(ctx) {
        ctx.output[0].imgUrl = 'https://example.test/completed.png';
        ctx.output.push({ fileName: 'incomplete.png' } as IImgInfo);
        throw new Error('Failure after first completed output');
      },
    });
    this.setConfig({ 'picBed.uploader': 'fixture-partial-uploader', debug: true });
    return originalUpload.call(this, input);
  });

  const result = await service.upload([imagePath]);
  assert.equal(result.results[0].status, 'error');
  assert.deepEqual(result.images.map(image => image.url), ['https://example.test/completed.png']);
});
