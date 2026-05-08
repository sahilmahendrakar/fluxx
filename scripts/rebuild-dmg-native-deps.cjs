'use strict';

/**
 * @electron-forge/maker-dmg → appdmg → macos-alias / fs-xattr ship native addons
 * without install scripts. pnpm's onlyBuiltDependencies skips most dependency
 * lifecycle hooks, so these .node files are never built unless we compile here.
 */
if (process.platform !== 'darwin') {
  process.exit(0);
}

const { spawnSync } = require('node:child_process');
const path = require('node:path');

function rebuild(pkgName) {
  let pkgDir;
  try {
    pkgDir = path.dirname(require.resolve(`${pkgName}/package.json`));
  } catch {
    return 0;
  }
  const nodeGyp = require.resolve('node-gyp/bin/node-gyp.js');
  const r = spawnSync(process.execPath, [nodeGyp, 'rebuild'], {
    cwd: pkgDir,
    stdio: 'inherit',
  });
  return r.status === null ? 1 : r.status;
}

let code = rebuild('macos-alias');
if (code !== 0) process.exit(code);
code = rebuild('fs-xattr');
process.exit(code);
