#!/usr/bin/env node
'use strict';

/**
 * Fluxx tmux pane launcher: reads a JSON spawn spec and execs the target process.
 * Invoked as `node fluxx-tmux-spawn.cjs <spec.json>` from `tmux new-session`.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function usage() {
  process.stderr.write('usage: fluxx-tmux-spawn.cjs <spec.json>\n');
  process.exit(2);
}

function readSpec(specPath) {
  const raw = fs.readFileSync(specPath, 'utf8');
  const spec = JSON.parse(raw);
  if (!spec || typeof spec !== 'object') throw new Error('invalid spawn spec');
  if (typeof spec.command !== 'string' || !spec.command.trim()) {
    throw new Error('spawn spec requires command');
  }
  if (!Array.isArray(spec.args) || spec.args.some((a) => typeof a !== 'string')) {
    throw new Error('spawn spec requires string[] args');
  }
  if (typeof spec.cwd !== 'string' || !spec.cwd.trim()) {
    throw new Error('spawn spec requires cwd');
  }
  return spec;
}

function buildEnv(specEnv) {
  const env = { ...process.env };
  if (!specEnv || typeof specEnv !== 'object') return env;
  for (const [key, value] of Object.entries(specEnv)) {
    if (typeof key !== 'string' || key.length === 0) continue;
    if (value === null || value === undefined) {
      delete env[key];
    } else if (typeof value === 'string') {
      env[key] = value;
    }
  }
  return env;
}

function main() {
  const specPath = process.argv[2];
  if (!specPath) usage();
  const resolved = path.resolve(specPath);
  const spec = readSpec(resolved);
  const env = buildEnv(spec.env);
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env,
    stdio: 'inherit',
  });
  child.on('error', (err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
  child.on('exit', (code, signal) => {
    if (signal) process.exit(1);
    process.exit(code ?? 1);
  });
}

main();
