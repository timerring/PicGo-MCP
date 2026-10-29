import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

export function normalizeSource(source: string): string {
  const value = source.trim();
  if (!value) throw new Error('Image source cannot be empty.');

  if (/^https?:\/\//i.test(value)) return new URL(value).href;

  let filePath: string;
  if (/^file:/i.test(value)) {
    filePath = fileURLToPath(value);
  } else if (isAbsolute(value) || win32.isAbsolute(value)) {
    filePath = value;
  } else if (value === '~' || /^~[/\\]/.test(value)) {
    filePath = resolve(homedir(), value.slice(2));
  } else {
    if (/^[a-z][a-z\d+.-]*:/i.test(value)) {
      throw new Error(`Unsupported image source protocol: ${value.split(':', 1)[0]}`);
    }
    filePath = resolve(value);
  }

  if (!existsSync(filePath)) throw new Error(`Image file does not exist: ${filePath}`);
  if (!statSync(filePath).isFile()) throw new Error(`Image source is not a file: ${filePath}`);
  return filePath;
}
