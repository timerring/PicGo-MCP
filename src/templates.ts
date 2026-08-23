import { basename, extname } from 'node:path';

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
  const extension = extname(originalName);
  const values: Record<string, string> = {
    ...dateValues(now),
    fileName: basename(originalName, extension),
    extName: extension,
    imgIdx: imageCount > 1 ? String(index) : '',
  };
  const rendered = template.replace(/\$\{(dateTime|date|fileName|extName|imgIdx)\}/g, (_, key: string) => values[key]);

  if (/\$\{[^}]+\}/.test(rendered)) {
    throw new Error(`Unsupported upload-name template expression in: ${template}`);
  }
  if (!rendered || rendered === '.' || rendered === '..' || basename(rendered) !== rendered) {
    throw new Error('The upload-name template must produce one non-empty file name without path separators.');
  }
  return rendered;
}

export function renderOutput(template: string, url: string, uploadedFileName: string): string {
  const extension = extname(uploadedFileName);
  const values: Record<string, string> = {
    url,
    uploadedName: basename(uploadedFileName, extension),
  };
  const rendered = template.replace(/\$\{(url|uploadedName)\}/g, (_, key: string) => values[key]);
  if (/\$\{[^}]+\}/.test(rendered)) {
    throw new Error(`Unsupported output template expression in: ${template}`);
  }
  return rendered;
}
