import { basename, extname } from 'node:path';

function validateTemplate(template: string, supported: string[]): void {
  if (typeof template !== 'string') throw new Error('Templates must be strings.');
  for (const match of template.matchAll(/\$\{([^}]*)\}/g)) {
    if (!supported.includes(match[1])) {
      throw new Error(`Unsupported template expression: ${match[0]}`);
    }
  }
  if (template.replace(/\$\{[^}]*\}/g, '').includes('${')) {
    throw new Error('Template expressions must end with a closing brace.');
  }
}

export function validateOutputTemplate(template: string): void {
  validateTemplate(template, ['url', 'uploadedName']);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
function dateValues(now: Date) {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return {
    date,
    dateTime: `${date}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`,
  };
}

export function renderUploadName(
  template: string,
  originalName: string,
  index: number,
  imageCount: number,
  now = new Date(),
): string {
  validateTemplate(template, ['dateTime', 'date', 'fileName', 'extName', 'imgIdx']);
  const extension = extname(originalName);
  const values: Record<string, string> = {
    ...dateValues(now),
    fileName: basename(originalName, extension),
    extName: extension,
    imgIdx: imageCount > 1 ? String(index) : '',
  };
  const rendered = template.replace(/\$\{(dateTime|date|fileName|extName|imgIdx)\}/g, (_, key: string) => values[key]);

  if (!rendered || rendered === '.' || rendered === '..' || /[\\/\0]/.test(rendered)) {
    throw new Error('The upload-name template must produce one non-empty file name without path separators.');
  }
  return rendered;
}

export function renderOutput(template: string, url: string, uploadedFileName: string): string {
  validateOutputTemplate(template);
  const extension = extname(uploadedFileName);
  const values: Record<string, string> = {
    url,
    uploadedName: basename(uploadedFileName, extension),
  };
  const rendered = template.replace(/\$\{(url|uploadedName)\}/g, (_, key: string) => values[key]);
  return rendered;
}
