import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

let cachedRoot: string | undefined;

/** The npm-workspaces root (the directory whose package.json has "workspaces"). */
export function repoRoot(): string {
  if (cachedRoot) return cachedRoot;
  let dir = __dirname;
  for (;;) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg) && 'workspaces' in JSON.parse(readFileSync(pkg, 'utf8'))) {
      return (cachedRoot = dir);
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`No workspace root found above ${__dirname}`);
    dir = parent;
  }
}

/** Runtime storage: <repo>/data unless DATA_DIR is set. */
export function dataDir(): string {
  return process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(repoRoot(), 'data');
}
