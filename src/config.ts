import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

export interface ConfigResolution {
  configPath: string;
  searchedPaths: string[];
  source: 'argument' | 'environment' | 'discovered' | 'default';
}
function expandHome(filePath: string): string {
  if (filePath === '~') return homedir();
  if (filePath.startsWith('~/') || filePath.startsWith('~\\')) {
    return resolve(homedir(), filePath.slice(2));
  }
  return isAbsolute(filePath) ? filePath : resolve(filePath);
}

export function defaultConfigCandidates(): string[] {
  const home = homedir();
  const candidates: string[] = [];

  if (platform() === 'darwin') {
    candidates.push(resolve(home, 'Library/Application Support/picgo/data.json'));
  } else if (platform() === 'win32' && process.env.APPDATA) {
    candidates.push(resolve(process.env.APPDATA, 'picgo/data.json'));
  } else {
    candidates.push(resolve(process.env.XDG_CONFIG_HOME ?? resolve(home, '.config'), 'picgo/data.json'));
  }

  // PicGo Core/CLI's default. vs-picgo can also be pointed here via picgo.configPath.
  candidates.push(resolve(home, '.picgo/config.json'));
  return [...new Set(candidates)];
}

export function resolveConfigPath(explicitPath?: string): ConfigResolution {
  if (explicitPath) {
    const configPath = expandHome(explicitPath);
    return { configPath, searchedPaths: [configPath], source: 'argument' };
  }

  if (process.env.PICGO_CONFIG_PATH) {
    const configPath = expandHome(process.env.PICGO_CONFIG_PATH);
    return { configPath, searchedPaths: [configPath], source: 'environment' };
  }

  const searchedPaths = defaultConfigCandidates();
  const found = searchedPaths.find(existsSync);
  if (found) {
    return { configPath: found, searchedPaths, source: 'discovered' };
  }

  return {
    configPath: searchedPaths.at(-1)!,
    searchedPaths,
    source: 'default',
  };
}
