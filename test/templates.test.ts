import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderOutput, renderUploadName } from '../src/templates.js';

test('renders a collision-resistant upload name', () => {
  const now = new Date(2026, 7, 23, 14, 32, 18);
  assert.equal(
    renderUploadName('${dateTime}-${fileName}${extName}', 'example.image.png', 0, 1, now),
    '2026-08-23-14-32-18-example.image.png',
  );
});
test('renders a zero-based index only for a batch', () => {
  const now = new Date(2026, 7, 23, 14, 32, 18);
  assert.equal(renderUploadName('${date}-${imgIdx}${extName}', 'a.png', 1, 3, now), '2026-08-23-1.png');
  assert.equal(renderUploadName('${date}-${imgIdx}${extName}', 'a.png', 0, 1, now), '2026-08-23-.png');
});

test('rejects unsupported expressions and path-producing templates', () => {
  assert.throws(() => renderUploadName('${unknown}.png', 'a.png', 0, 1), /Unsupported/);
  assert.throws(() => renderUploadName('../${fileName}${extName}', 'a.png', 0, 1), /path separators/);
});

test('renders URL and Markdown output formats without evaluating code', () => {
  const url = 'https://example.test/image.png';
  assert.equal(renderOutput('${url}', url, 'image.png'), url);
  assert.equal(renderOutput('![${uploadedName}](${url})', url, 'image.png'), `![image](${url})`);
});
