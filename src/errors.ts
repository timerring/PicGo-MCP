import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function redactHomePath(value: string): string {
  const home = homedir();
  const paths = new Map([
    [pathToFileURL(home).href, 'file://~'],
    [home, '~'],
    [home.replaceAll('\\', '/'), '~'],
  ]);
  let redacted = value;
  for (const [path, replacement] of paths) {
    const pattern = new RegExp(
      `(?<![\\w./\\\\~-])${escapeRegExp(path)}(?=$|[/\\\\\\s"'\x60),;:\\]}!?])`,
      process.platform === 'win32' ? 'gi' : 'g',
    );
    redacted = redacted.replace(pattern, () => replacement);
  }
  return redacted;
}

export function publicErrorMessage(error: unknown): string {
  return redactHomePath(error instanceof Error ? error.message : String(error));
}
