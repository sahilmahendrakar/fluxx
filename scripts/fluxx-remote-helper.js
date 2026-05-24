#!/usr/bin/env node
'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const VERSION = '0.2.6';

const { createRemoteWorktreePrep } = require('./lib/remoteWorktreePrep');

const FLUXX_TMUX_SOCKET = 'fluxx';
const SETUP_DEFAULT_TIMEOUT_MS = 300_000;

function emit(payload) {
  process.stdout.write(`${JSON.stringify({ version: VERSION, ...payload })}\n`);
}

function fail(code, message) {
  emit({ ok: false, error: { code, message } });
  process.exit(1);
}

function readStdinJson() {
  try {
    const text = fs.readFileSync(0, 'utf8').trim();
    if (!text) return {};
    return JSON.parse(text);
  } catch (err) {
    fail('INTERNAL', err instanceof Error ? err.message : String(err));
  }
}

function runCapture(command, args, opts = {}) {
  try {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: process.env,
    timeout: opts.timeoutMs ?? 30_000,
  });
    if (result.error) {
      return { ok: false, error: result.error.message };
    }
    if (result.status !== 0) {
      const stderr = (result.stderr || '').trim();
      return { ok: false, error: stderr || `${command} exited ${result.status}` };
    }
    return { ok: true, stdout: (result.stdout || '').trim() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function which(command) {
  const result = runCapture('command', ['-v', command]);
  if (!result.ok || !result.stdout) return null;
  return result.stdout.split('\n')[0].trim() || null;
}

function expandHome(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') return inputPath;
  if (inputPath === '~') return os.homedir();
  if (inputPath.startsWith('~/')) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

function probeTool(command, versionArgs = ['--version']) {
  const binPath = which(command);
  if (!binPath) {
    return { found: false };
  }
  const versionResult = runCapture(binPath, versionArgs);
  return {
    found: true,
    path: binPath,
    version: versionResult.ok ? versionResult.stdout.split('\n')[0] : undefined,
  };
}

function probeWorkspaceRoot(workspaceRoot) {
  const resolved = expandHome(workspaceRoot);
  try {
    fs.mkdirSync(resolved, { recursive: true });
    const probeFile = path.join(resolved, `.fluxx-write-probe-${process.pid}`);
    fs.writeFileSync(probeFile, 'ok', 'utf8');
    fs.unlinkSync(probeFile);
    return { path: resolved, writable: true };
  } catch (err) {
    return {
      path: resolved,
      writable: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function sshHostFromGitRemoteUrl(remoteUrl) {
  const scpStyle = /^[^@]+@([^:/]+):/.exec(remoteUrl);
  if (scpStyle) return scpStyle[1];
  try {
    const parsed = new URL(remoteUrl);
    if (parsed.protocol === 'ssh:') return parsed.hostname || null;
  } catch {
    // not a URL
  }
  return null;
}

function sshHostKeyKnown(host) {
  const result = runCapture('ssh-keygen', ['-F', host]);
  return result.ok && Boolean(result.stdout && result.stdout.trim());
}

function ensureSshHostKnown(host) {
  if (!host) return { ok: true };
  if (sshHostKeyKnown(host)) return { ok: true };
  const sshDir = path.join(os.homedir(), '.ssh');
  try {
    fs.mkdirSync(sshDir, { recursive: true, mode: 0o700 });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  const scan = runCapture('ssh-keyscan', ['-H', host], { timeoutMs: 30_000 });
  if (!scan.ok || !scan.stdout) {
    return {
      ok: false,
      error: scan.error || `ssh-keyscan failed for ${host}`,
    };
  }
  const knownHostsPath = path.join(sshDir, 'known_hosts');
  fs.appendFileSync(knownHostsPath, `${scan.stdout.trim()}\n`, { mode: 0o644 });
  return { ok: true };
}

function probeRepoAccess(repo) {
  const remoteUrl = typeof repo.remoteUrl === 'string' ? repo.remoteUrl.trim() : '';
  if (!remoteUrl) {
    return { accessible: false, error: 'Missing remote URL' };
  }
  const sshHost = sshHostFromGitRemoteUrl(remoteUrl);
  if (sshHost) {
    const known = ensureSshHostKnown(sshHost);
    if (!known.ok) {
      return { accessible: false, error: known.error || `Could not trust SSH host ${sshHost}` };
    }
  }
  const result = runCapture('git', ['ls-remote', '--heads', remoteUrl, 'HEAD'], {
    timeoutMs: 60_000,
  });
  if (!result.ok) {
    return { accessible: false, error: result.error || 'git ls-remote failed' };
  }
  return { accessible: true };
}

function runProbe(params) {
  const workspaceRoot =
    typeof params.workspaceRoot === 'string' && params.workspaceRoot.trim()
      ? params.workspaceRoot.trim()
      : '~/.fluxx/workspaces';
  const requireTmux = params.requireTmux === true;
  const shellPreference =
    typeof params.shell === 'string' && params.shell.trim() ? params.shell.trim() : undefined;
  const agentCommands = Array.isArray(params.agentCommands)
    ? params.agentCommands.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim())
    : ['claude', 'agent', 'codex'];
  const repos = Array.isArray(params.repos) ? params.repos : [];

  const platform = `${os.type()} ${os.release()}`;
  const arch = os.arch();
  const shellPath = shellPreference || process.env.SHELL || which('bash') || which('sh') || undefined;
  const git = probeTool('git');
  const tmux = probeTool('tmux', ['-V']);
  const workspace = probeWorkspaceRoot(workspaceRoot);
  const agents = agentCommands.map((command) => ({
    command,
    ...probeTool(command),
  }));
  const repoResults = repos.map((repo) => {
    const repoId = typeof repo.repoId === 'string' ? repo.repoId : 'unknown';
    const label = typeof repo.label === 'string' ? repo.label : undefined;
    const remoteUrl = typeof repo.remoteUrl === 'string' ? repo.remoteUrl : undefined;
    const access = probeRepoAccess(repo);
    return {
      repoId,
      label,
      remoteUrl,
      accessible: access.accessible,
      ...(access.error ? { error: access.error } : {}),
    };
  });

  const capabilities = {
    os: platform,
    arch,
    shell: shellPath,
    git,
    tmux,
    workspaceRoot: {
      path: workspace.path,
      writable: workspace.writable,
    },
    agents,
    repos: repoResults,
  };

  if (!git.found) {
    emit({
      ok: false,
      error: {
        code: 'REMOTE_GIT_MISSING',
        message: 'git was not found on PATH',
      },
      data: capabilities,
    });
    process.exit(1);
  }
  if (requireTmux && !tmux.found) {
    emit({
      ok: false,
      error: {
        code: 'REMOTE_TMUX_MISSING',
        message: 'tmux was not found on PATH',
      },
      data: capabilities,
    });
    process.exit(1);
  }
  if (!workspace.writable) {
    emit({
      ok: false,
      error: {
        code: 'REMOTE_WORKSPACE_UNWRITABLE',
        message: workspace.error || `Cannot write to workspace root ${workspace.path}`,
      },
      data: capabilities,
    });
    process.exit(1);
  }
  const failedRepo = repoResults.find((r) => !r.accessible);
  if (failedRepo) {
    emit({
      ok: false,
      error: {
        code: 'REMOTE_REPO_ACCESS_FAILED',
        message: failedRepo.error
          ? `Repo ${failedRepo.label || failedRepo.repoId}: ${failedRepo.error}`
          : `Repo ${failedRepo.label || failedRepo.repoId} is not accessible from this host`,
      },
      data: capabilities,
    });
    process.exit(1);
  }

  emit({ ok: true, data: capabilities });
}

function gitRun(args, opts = {}) {
  const cwd = opts.cwd;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    env: process.env,
    timeout: timeoutMs,
    cwd: cwd || undefined,
  });
  if (result.error) {
    return { ok: false, error: result.error.message };
  }
  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    return { ok: false, error: stderr || `git exited ${result.status}` };
  }
  return { ok: true, stdout: (result.stdout || '').trim() };
}

const worktreePrep = createRemoteWorktreePrep({ gitRun, fs, path });

function repoMetaPath(repoPath) {
  return path.join(repoPath, '.fluxx', 'repo-meta.json');
}

function readRepoMeta(repoPath) {
  try {
    const raw = fs.readFileSync(repoMetaPath(repoPath), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeRepoMeta(repoPath, meta) {
  fs.mkdirSync(path.join(repoPath, '.fluxx'), { recursive: true });
  fs.writeFileSync(repoMetaPath(repoPath), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
}

function normalizeRemoteUrl(url) {
  return String(url || '')
    .trim()
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
}

function sanitizePathSegment(segment) {
  const trimmed = String(segment || '').trim();
  if (!trimmed) return '_';
  return trimmed.replace(/[/\\]/g, '_');
}

function repoCachePath(workspaceRoot, projectId, repoId) {
  return path.join(
    expandHome(workspaceRoot),
    'repos',
    sanitizePathSegment(projectId),
    sanitizePathSegment(repoId),
  );
}

function remoteTaskWorktreePathOnHost(workspaceRoot, projectId, repoId, taskId) {
  return path.join(
    expandHome(workspaceRoot),
    'worktrees',
    sanitizePathSegment(projectId),
    sanitizePathSegment(repoId),
    sanitizePathSegment(taskId),
  );
}

/** Pre–0.2.4 layout: worktrees/{projectId}/{taskId} (no repoId segment). */
function legacyRemoteTaskWorktreePathOnHost(workspaceRoot, projectId, taskId) {
  return path.join(
    expandHome(workspaceRoot),
    'worktrees',
    sanitizePathSegment(projectId),
    sanitizePathSegment(taskId),
  );
}

function ensureFluxxTmuxConfig() {
  const fluxxDir = path.join(os.homedir(), '.fluxx');
  fs.mkdirSync(fluxxDir, { recursive: true });
  const confPath = path.join(fluxxDir, 'fluxx-tmux.conf');
  if (!fs.existsSync(confPath)) {
    fs.writeFileSync(
      confPath,
      'set -g mouse on\nset -g history-limit 50000\nset -g detach-on-destroy off\n',
      'utf8',
    );
  }
  return confPath;
}

function tmuxArgs(subArgs) {
  const confPath = ensureFluxxTmuxConfig();
  return ['-L', FLUXX_TMUX_SOCKET, '-f', confPath, ...subArgs];
}

function assertRepoPathWritable(repoPath) {
  try {
    fs.accessSync(repoPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function runProbeRepoPath(params) {
  const remotePathRaw =
    typeof params.remotePath === 'string' ? params.remotePath.trim() : '';
  const remoteUrl = typeof params.remoteUrl === 'string' ? params.remoteUrl.trim() : '';
  if (!remotePathRaw) {
    fail('INTERNAL', 'probe-repo-path requires remotePath');
  }
  if (!remoteUrl) {
    fail('INTERNAL', 'probe-repo-path requires remoteUrl');
  }
  if (!which('git')) {
    fail('REMOTE_GIT_MISSING', 'git was not found on PATH');
  }
  const repoPath = expandHome(remotePathRaw);
  if (!path.isAbsolute(repoPath)) {
    fail('INTERNAL', 'Remote path must be absolute');
  }
  if (!fs.existsSync(repoPath)) {
    fail('REMOTE_REPO_MISMATCH', `Path does not exist: ${remotePathRaw}`);
  }
  const stat = fs.statSync(repoPath);
  if (!stat.isDirectory()) {
    fail('REMOTE_REPO_MISMATCH', `Path is not a directory: ${remotePathRaw}`);
  }
  if (!assertRepoPathWritable(repoPath)) {
    fail('REMOTE_WORKSPACE_UNWRITABLE', `Path is not writable: ${remotePathRaw}`);
  }
  const gitDir = path.join(repoPath, '.git');
  if (!fs.existsSync(gitDir)) {
    fail('REMOTE_REPO_MISMATCH', `Path is not a git repository: ${remotePathRaw}`);
  }
  const origin = gitRun(['remote', 'get-url', 'origin'], { cwd: repoPath });
  if (!origin.ok) {
    fail('REMOTE_REPO_MISMATCH', `Could not read git remote origin at ${remotePathRaw}`);
  }
  if (normalizeRemoteUrl(origin.stdout) !== normalizeRemoteUrl(remoteUrl)) {
    fail(
      'REMOTE_REPO_MISMATCH',
      `Repository origin (${origin.stdout.trim()}) does not match expected ${remoteUrl}.`,
    );
  }
  const fetch = gitRun(['fetch', 'origin', '--prune'], { cwd: repoPath, timeoutMs: 180_000 });
  if (!fetch.ok) {
    fail(
      'REMOTE_REPO_ACCESS_FAILED',
      `git fetch failed for ${remoteUrl}: ${fetch.error}`,
    );
  }
  emit({
    ok: true,
    data: {
      resolvedPath: repoPath,
      originUrl: origin.stdout.trim(),
      writable: true,
    },
  });
}

function runRepoEnsure(params) {
  const workspaceRoot =
    typeof params.workspaceRoot === 'string' && params.workspaceRoot.trim()
      ? params.workspaceRoot.trim()
      : '~/.fluxx/workspaces';
  const projectId = typeof params.projectId === 'string' ? params.projectId.trim() : '';
  const repoId = typeof params.repoId === 'string' ? params.repoId.trim() : '';
  const remoteUrl = typeof params.remoteUrl === 'string' ? params.remoteUrl.trim() : '';
  if (!projectId || !repoId || !remoteUrl) {
    fail('INTERNAL', 'repo-ensure requires projectId, repoId, and remoteUrl');
  }

  if (!which('git')) {
    fail('REMOTE_GIT_MISSING', 'git was not found on PATH');
  }

  const boundRepoPath =
    typeof params.repoPath === 'string' && params.repoPath.trim()
      ? expandHome(params.repoPath.trim())
      : '';
  if (boundRepoPath) {
    if (!path.isAbsolute(boundRepoPath)) {
      fail('INTERNAL', 'repoPath must be absolute');
    }
    if (!fs.existsSync(boundRepoPath)) {
      fail('REMOTE_REPO_MISMATCH', `Bound repo path does not exist: ${params.repoPath}`);
    }
    const gitDir = path.join(boundRepoPath, '.git');
    if (!fs.existsSync(gitDir)) {
      fail('REMOTE_REPO_MISMATCH', `Bound path is not a git repository: ${params.repoPath}`);
    }
    if (!assertRepoPathWritable(boundRepoPath)) {
      fail('REMOTE_WORKSPACE_UNWRITABLE', `Bound path is not writable: ${params.repoPath}`);
    }
    const origin = gitRun(['remote', 'get-url', 'origin'], { cwd: boundRepoPath });
    if (!origin.ok) {
      fail('REMOTE_REPO_MISMATCH', `Could not read git remote origin at ${params.repoPath}`);
    }
    if (normalizeRemoteUrl(origin.stdout) !== normalizeRemoteUrl(remoteUrl)) {
      fail(
        'REMOTE_REPO_MISMATCH',
        `Bound repository origin (${origin.stdout.trim()}) does not match expected ${remoteUrl}.`,
      );
    }
    const fetch = gitRun(['fetch', 'origin', '--prune'], {
      cwd: boundRepoPath,
      timeoutMs: 180_000,
    });
    if (!fetch.ok) {
      fail(
        'REMOTE_REPO_ACCESS_FAILED',
        `git fetch failed for ${remoteUrl}: ${fetch.error}`,
      );
    }
    emit({ ok: true, data: { repoPath: boundRepoPath, action: 'validated' } });
    return;
  }

  const repoPath = repoCachePath(workspaceRoot, projectId, repoId);
  fs.mkdirSync(path.dirname(repoPath), { recursive: true });

  const expectedMeta = { projectId, repoId, remoteUrl };
  const gitDir = path.join(repoPath, '.git');

  if (fs.existsSync(gitDir)) {
    const meta = readRepoMeta(repoPath);
    if (meta) {
      if (meta.repoId !== repoId || meta.projectId !== projectId) {
        fail(
          'REMOTE_REPO_MISMATCH',
          `Existing repo cache at ${repoPath} belongs to a different Fluxx repo (${meta.repoId}).`,
        );
      }
      if (normalizeRemoteUrl(meta.remoteUrl) !== normalizeRemoteUrl(remoteUrl)) {
        fail(
          'REMOTE_REPO_MISMATCH',
          `Existing repo cache remote URL (${meta.remoteUrl}) does not match expected ${remoteUrl}.`,
        );
      }
    }
    const origin = gitRun(['remote', 'get-url', 'origin'], { cwd: repoPath });
    if (origin.ok && normalizeRemoteUrl(origin.stdout) !== normalizeRemoteUrl(remoteUrl)) {
      fail(
        'REMOTE_REPO_MISMATCH',
        `Existing clone origin (${origin.stdout}) does not match expected ${remoteUrl}.`,
      );
    }
    const fetch = gitRun(['fetch', 'origin', '--prune'], { cwd: repoPath, timeoutMs: 180_000 });
    if (!fetch.ok) {
      fail(
        'REMOTE_REPO_ACCESS_FAILED',
        `git fetch failed for ${remoteUrl}: ${fetch.error}`,
      );
    }
    if (!meta) {
      writeRepoMeta(repoPath, expectedMeta);
    }
    emit({ ok: true, data: { repoPath, action: 'fetched' } });
    return;
  }

  if (fs.existsSync(repoPath)) {
    fail(
      'REMOTE_REPO_MISMATCH',
      `Path ${repoPath} exists but is not a git repository.`,
    );
  }

  const sshHost = sshHostFromGitRemoteUrl(remoteUrl);
  if (sshHost) {
    const known = ensureSshHostKnown(sshHost);
    if (!known.ok) {
      fail('REMOTE_REPO_ACCESS_FAILED', known.error || `Could not trust SSH host ${sshHost}`);
    }
  }

  const clone = gitRun(['clone', remoteUrl, repoPath], { timeoutMs: 300_000 });
  if (!clone.ok) {
    fail(
      'REMOTE_REPO_ACCESS_FAILED',
      `git clone failed for ${remoteUrl}: ${clone.error}`,
    );
  }
  writeRepoMeta(repoPath, expectedMeta);
  emit({ ok: true, data: { repoPath, action: 'cloned' } });
}

function slugifySegment(raw, maxLen) {
  const ascii = String(raw || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!ascii) return '';
  if (ascii.length <= maxLen) return ascii;
  return ascii.slice(0, maxLen).replace(/-+$/g, '');
}

function branchLooksValid(name) {
  return /^[A-Za-z0-9._/-]+$/.test(name) && !name.includes('..') && !name.endsWith('/');
}

function resolveAuthorSlug(gitRoot) {
  const name = gitRun(['config', '--get', 'user.name'], { cwd: gitRoot });
  const fromName = slugifySegment(name.ok ? name.stdout : '', 40);
  if (fromName) return fromName;
  const email = gitRun(['config', '--get', 'user.email'], { cwd: gitRoot });
  const local = email.ok && email.stdout.includes('@') ? email.stdout.split('@')[0] : email.stdout;
  const fromEmail = slugifySegment(local, 40);
  return fromEmail || 'fluxx-user';
}

function collectTakenBranchNames(gitRoot) {
  const taken = new Set();
  const branches = gitRun(['branch', '--list', '--format=%(refname:short)'], { cwd: gitRoot });
  if (branches.ok) {
    for (const line of branches.stdout.split('\n')) {
      const s = line.trim();
      if (s) taken.add(s.toLowerCase());
    }
  }
  return taken;
}

function chooseWorkBranch(input) {
  const author = slugifySegment(input.authorSlug, 40) || 'fluxx-user';
  const titleBase =
    slugifySegment(input.taskTitle, 200) ||
    `task-${require('node:crypto').createHash('sha256').update(input.taskId).digest('hex').slice(0, 12)}`;
  const taken = input.taken;
  const tryName = (titlePart) => {
    const candidate = `${author}/${titlePart}`;
    if (!branchLooksValid(candidate)) return null;
    if (taken.has(candidate.toLowerCase())) return null;
    return candidate;
  };
  const first = tryName(titleBase);
  if (first) return first;
  for (let n = 2; n <= 99; n++) {
    const withNum = tryName(`${titleBase}-${n}`);
    if (withNum) return withNum;
  }
  const h = require('node:crypto')
    .createHash('sha256')
    .update(`${input.taskId}:${titleBase}`)
    .digest('hex')
    .slice(0, 7);
  return tryName(`${titleBase}-${h}`) || `${author}/task-${input.taskId.slice(0, 8)}`;
}

function resolveRef(gitRoot, branchShort) {
  const local = gitRun(['rev-parse', '--verify', '--quiet', `refs/heads/${branchShort}`], {
    cwd: gitRoot,
  });
  if (local.ok) return { ref: branchShort, kind: 'local' };
  const remote = gitRun(
    ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branchShort}`],
    { cwd: gitRoot },
  );
  if (remote.ok) return { ref: `origin/${branchShort}`, kind: 'remote' };
  return null;
}

function resolveBaseRef(gitRoot, configuredBranch) {
  let defaultBranch = configuredBranch?.trim() || 'main';
  gitRun(['fetch', 'origin', defaultBranch], { cwd: gitRoot, timeoutMs: 120_000 });
  const originHead = gitRun(
    ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${defaultBranch}`],
    { cwd: gitRoot },
  );
  if (originHead.ok) return `origin/${defaultBranch}`;
  const localHead = gitRun(['rev-parse', '--verify', '--quiet', `refs/heads/${defaultBranch}`], {
    cwd: gitRoot,
  });
  if (localHead.ok) return defaultBranch;
  return null;
}

function writeContextFiles(worktreePath, files) {
  if (!Array.isArray(files)) return;
  for (const file of files) {
    if (!file || typeof file.relativePath !== 'string' || typeof file.content !== 'string') {
      continue;
    }
    const rel = file.relativePath.replace(/^\/+/, '');
    if (!rel || rel.includes('..')) continue;
    const target = path.join(worktreePath, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.content, 'utf8');
  }
}

function runSetupScript(worktreePath, script, timeoutMs) {
  if (!script || !String(script).trim()) return { ok: true };
  const logPath = path.join(worktreePath, '.flux-setup.log');
  fs.writeFileSync(logPath, `# flux setup script — ${new Date().toISOString()}\n`, 'utf8');
  const result = spawnSync('bash', ['-lc', script], {
    cwd: worktreePath,
    encoding: 'utf8',
    timeout: timeoutMs ?? SETUP_DEFAULT_TIMEOUT_MS,
    env: process.env,
  });
  if (result.stdout) fs.appendFileSync(logPath, result.stdout, 'utf8');
  if (result.stderr) fs.appendFileSync(logPath, result.stderr, 'utf8');
  if (result.status !== 0) {
    const stderrTail = (result.stderr || '').trim().split('\n').slice(-4).join('\n').trim();
    const warning = stderrTail
      ? `Setup script exited with code ${result.status} (see ${logPath}): ${stderrTail}`
      : `Setup script exited with code ${result.status} (see ${logPath})`;
    process.stderr.write(`[fluxx-remote-helper] ${warning}\n`);
    // Match local WorktreeService: setup failures are logged, not session-blocking.
    return { ok: true, warning };
  }
  return { ok: true };
}

function emitWorktreeCreateSuccess(worktreePath, branch, setup) {
  const data = { worktreePath, branch };
  if (setup?.warning) {
    data.setupWarning = setup.warning;
  }
  emit({ ok: true, data });
}

function runWorktreeCreate(params) {
  const workspaceRoot =
    typeof params.workspaceRoot === 'string' && params.workspaceRoot.trim()
      ? params.workspaceRoot.trim()
      : '~/.fluxx/workspaces';
  const projectId = typeof params.projectId === 'string' ? params.projectId.trim() : '';
  const repoId = typeof params.repoId === 'string' ? params.repoId.trim() : '';
  const taskId = typeof params.taskId === 'string' ? params.taskId.trim() : '';
  const repoPath = typeof params.repoPath === 'string' ? expandHome(params.repoPath.trim()) : '';
  const worktreePath =
    projectId && repoId && taskId
      ? remoteTaskWorktreePathOnHost(workspaceRoot, projectId, repoId, taskId)
      : expandHome(typeof params.worktreePath === 'string' ? params.worktreePath.trim() : '');
  const sourceBranchShort =
    typeof params.sourceBranchShort === 'string' ? params.sourceBranchShort.trim() : '';
  const createSourceBranchIfMissing = params.createSourceBranchIfMissing === true;
  const baseBranch = typeof params.baseBranch === 'string' ? params.baseBranch.trim() : 'main';
  if (!repoPath || !worktreePath || !sourceBranchShort) {
    fail('INTERNAL', 'worktree-create requires repoPath, worktreePath, and sourceBranchShort');
  }

  try {
    fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
  } catch (err) {
    fail(
      'REMOTE_WORKSPACE_UNWRITABLE',
      err instanceof Error
        ? `Cannot create worktree directory ${worktreePath}: ${err.message}`
        : `Cannot create worktree directory ${worktreePath}`,
    );
  }

  let branch = typeof params.fluxxWorkBranch === 'string' ? params.fluxxWorkBranch.trim() : '';
  if (!branch || !branchLooksValid(branch)) {
    branch = chooseWorkBranch({
      authorSlug: resolveAuthorSlug(repoPath),
      taskTitle: typeof params.taskTitle === 'string' ? params.taskTitle : '',
      taskId: typeof params.taskId === 'string' ? params.taskId : 'task',
      taken: collectTakenBranchNames(repoPath),
    });
  }

  if (projectId && taskId) {
    const legacyPath = legacyRemoteTaskWorktreePathOnHost(workspaceRoot, projectId, taskId);
    if (legacyPath !== worktreePath && fs.existsSync(legacyPath)) {
      process.stderr.write(
        `[fluxx-remote-helper] reclaiming legacy worktree path ${legacyPath}\n`,
      );
      worktreePrep.prepareWorktreePath(legacyPath, repoPath, branch);
    }
  }

  const prepState = worktreePrep.prepareWorktreePath(worktreePath, repoPath, branch);
  if (prepState === 'healthy') {
    writeContextFiles(worktreePath, params.contextFiles);
    const setup = runSetupScript(
      worktreePath,
      params.setupScript,
      params.setupTimeoutMs,
    );
    emitWorktreeCreateSuccess(worktreePath, branch, setup);
    return;
  }

  gitRun(['fetch', 'origin', sourceBranchShort], { cwd: repoPath, timeoutMs: 120_000 });

  const branchExists = gitRun(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], {
    cwd: repoPath,
  }).ok;

  if (branchExists) {
    const add = gitRun(['worktree', 'add', worktreePath, branch], { cwd: repoPath });
    if (!add.ok) fail('WORKTREE_FAILED', add.error || 'git worktree add failed');
  } else {
    let startRef = resolveRef(repoPath, sourceBranchShort);
    if (!startRef && createSourceBranchIfMissing) {
      const baseRef = resolveBaseRef(repoPath, baseBranch);
      if (!baseRef) {
        fail(
          'WORKTREE_BASE_BRANCH_UNAVAILABLE',
          `Cannot create missing source branch '${sourceBranchShort}': project default branch '${baseBranch}' is not available.`,
        );
      }
      const created = gitRun(['branch', sourceBranchShort, baseRef], { cwd: repoPath });
      if (!created.ok) {
        fail(
          'WORKTREE_SOURCE_BRANCH_CREATE_FAILED',
          `Could not create source branch '${sourceBranchShort}': ${created.error}`,
        );
      }
      startRef = resolveRef(repoPath, sourceBranchShort);
    }
    if (!startRef) {
      fail(
        'WORKTREE_SOURCE_BRANCH_MISSING',
        createSourceBranchIfMissing
          ? `Could not resolve or create source branch '${sourceBranchShort}'.`
          : `Source branch '${sourceBranchShort}' does not exist locally or as origin/${sourceBranchShort}.`,
      );
    }
    const add = gitRun(['worktree', 'add', worktreePath, '-b', branch, startRef.ref], {
      cwd: repoPath,
    });
    if (!add.ok) fail('WORKTREE_FAILED', add.error || 'git worktree add failed');
  }

  writeContextFiles(worktreePath, params.contextFiles);
  const setup = runSetupScript(worktreePath, params.setupScript, params.setupTimeoutMs);
  emitWorktreeCreateSuccess(worktreePath, branch, setup);
}

function manifestPathForDevice(deviceId) {
  return path.join(
    os.homedir(),
    '.fluxx',
    'devices',
    String(deviceId).replace(/[/\\]/g, '_'),
    'terminal-sessions.json',
  );
}

function readManifest(deviceId) {
  const filePath = manifestPathForDevice(deviceId);
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (parsed && Array.isArray(parsed.terminals)) {
      return parsed.terminals;
    }
  } catch {
    // missing or invalid
  }
  return [];
}

function writeManifest(deviceId, terminals) {
  const filePath = manifestPathForDevice(deviceId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const payload = { version: 1, terminals };
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function runStartTerminal(params) {
  if (!which('tmux')) {
    fail('REMOTE_TMUX_MISSING', 'tmux was not found on PATH');
  }
  const terminalId = typeof params.terminalId === 'string' ? params.terminalId.trim() : '';
  const deviceId = typeof params.deviceId === 'string' ? params.deviceId.trim() : '';
  const cwd = typeof params.cwd === 'string' ? expandHome(params.cwd.trim()) : '';
  const tmuxSessionName =
    typeof params.tmuxSessionName === 'string' ? params.tmuxSessionName.trim() : '';
  const command = typeof params.command === 'string' ? params.command.trim() : '';
  const args = Array.isArray(params.args)
    ? params.args.filter((a) => typeof a === 'string')
    : [];
  if (!terminalId || !deviceId || !cwd || !tmuxSessionName || !command) {
    fail('INTERNAL', 'start-terminal requires terminalId, deviceId, cwd, tmuxSessionName, and command');
  }

  const hasSession = runCapture('tmux', tmuxArgs(['has-session', '-t', tmuxSessionName]));
  if (hasSession.ok) {
    fail('INTERNAL', `tmux session ${tmuxSessionName} already exists`);
  }

  const cmdParts = [shellQuote(command), ...args.map(shellQuote)];
  const remoteCmd = cmdParts.join(' ');
  const tmuxResult = runCapture(
    'tmux',
    tmuxArgs([
      'new-session',
      '-d',
      '-s',
      tmuxSessionName,
      '-c',
      cwd,
      '-x',
      String(Math.max(1, Number(params.cols) || 80)),
      '-y',
      String(Math.max(1, Number(params.rows) || 24)),
      '--',
      'sh',
      '-lc',
      remoteCmd,
    ]),
    { timeoutMs: 30_000 },
  );
  if (!tmuxResult.ok) {
    fail('INTERNAL', tmuxResult.error || 'tmux new-session failed');
  }

  const startedAt = new Date().toISOString();
  const row = {
    id: terminalId,
    kind: 'task',
    runtime: 'tmux',
    projectId: String(params.projectId || ''),
    repoId: typeof params.repoId === 'string' ? params.repoId : undefined,
    deviceId,
    deviceKind: 'ssh',
    hostLabel: typeof params.hostLabel === 'string' ? params.hostLabel : undefined,
    cwd,
    tmuxSessionName,
    command,
    args,
    cols: Math.max(1, Number(params.cols) || 80),
    rows: Math.max(1, Number(params.rows) || 24),
    startedAt,
    task: {
      taskId: String(params.taskId || ''),
      agent: String(params.agent || ''),
      worktreePath: cwd,
      fluxxWorkBranch: String(params.fluxxWorkBranch || ''),
      ...(typeof params.sourceBranchShort === 'string' && params.sourceBranchShort.trim()
        ? { sourceBranchShort: params.sourceBranchShort.trim() }
        : {}),
    },
  };

  const existing = readManifest(deviceId).filter((t) => t.id !== terminalId);
  writeManifest(deviceId, [...existing, row]);
  emit({ ok: true, data: { terminalId, tmuxSessionName, startedAt } });
}

function runListTerminals(params) {
  const deviceId = typeof params.deviceId === 'string' ? params.deviceId.trim() : '';
  if (!deviceId) {
    fail('INTERNAL', 'list-terminals requires deviceId');
  }
  emit({ ok: true, data: { terminals: readManifest(deviceId).filter((t) => !t.endedAt) } });
}

function findOpenTerminalRow(terminalId) {
  const trimmed = typeof terminalId === 'string' ? terminalId.trim() : '';
  if (!trimmed) return null;
  const devicesRoot = path.join(os.homedir(), '.fluxx', 'devices');
  let deviceDirs = [];
  try {
    deviceDirs = fs
      .readdirSync(devicesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return null;
  }
  for (const deviceId of deviceDirs) {
    const rows = readManifest(deviceId).filter((t) => !t.endedAt);
    const row = rows.find((t) => t.id === trimmed);
    if (row) {
      return { deviceId, row };
    }
  }
  return null;
}

function runAttachTerminal(terminalId) {
  const found = findOpenTerminalRow(terminalId);
  if (!found) {
    process.stderr.write(`Fluxx terminal ${terminalId} was not found in the remote manifest.\n`);
    process.exit(1);
  }
  const tmuxSessionName =
    typeof found.row.tmuxSessionName === 'string' ? found.row.tmuxSessionName.trim() : '';
  if (!tmuxSessionName) {
    process.stderr.write('Remote terminal manifest row is missing tmuxSessionName.\n');
    process.exit(1);
  }
  const hasSession = runCapture('tmux', tmuxArgs(['has-session', '-t', tmuxSessionName]));
  if (!hasSession.ok) {
    process.stderr.write(`Remote tmux session ${tmuxSessionName} is not running.\n`);
    process.exit(1);
  }
  const child = spawn('tmux', tmuxArgs(['attach-session', '-t', tmuxSessionName]), {
    stdio: 'inherit',
    env: process.env,
  });
  child.on('exit', (code, signal) => {
    if (typeof code === 'number') {
      process.exit(code);
    }
    process.exit(signal ? 128 : 0);
  });
}

function runStopTerminal(params) {
  const terminalId = typeof params.terminalId === 'string' ? params.terminalId.trim() : '';
  const deviceId = typeof params.deviceId === 'string' ? params.deviceId.trim() : '';
  const reason =
    typeof params.reason === 'string' && params.reason.trim()
      ? params.reason.trim()
      : 'user-stopped';
  if (!terminalId || !deviceId) {
    fail('INTERNAL', 'stop-terminal requires terminalId and deviceId');
  }
  const rows = readManifest(deviceId);
  const row = rows.find((t) => t.id === terminalId && !t.endedAt);
  if (!row) {
    emit({ ok: true, data: { stopped: false, terminalId, reason: 'not-found' } });
    return;
  }
  if (row.tmuxSessionName) {
    runCapture('tmux', tmuxArgs(['kill-session', '-t', row.tmuxSessionName]));
  }
  const endedAt = new Date().toISOString();
  const remaining = rows.map((t) =>
    t.id === terminalId ? { ...t, endedAt, endedReason: reason } : t,
  );
  writeManifest(deviceId, remaining);
  emit({ ok: true, data: { stopped: true, terminalId, endedAt, reason } });
}

function runStartShell(params) {
  if (!which('tmux')) {
    fail('REMOTE_TMUX_MISSING', 'tmux was not found on PATH');
  }
  const terminalId = typeof params.terminalId === 'string' ? params.terminalId.trim() : '';
  const deviceId = typeof params.deviceId === 'string' ? params.deviceId.trim() : '';
  const parentSessionId =
    typeof params.parentSessionId === 'string' ? params.parentSessionId.trim() : '';
  const cwd = typeof params.cwd === 'string' ? expandHome(params.cwd.trim()) : '';
  const tmuxSessionName =
    typeof params.tmuxSessionName === 'string' ? params.tmuxSessionName.trim() : '';
  const projectId = typeof params.projectId === 'string' ? params.projectId.trim() : '';
  if (!terminalId || !deviceId || !parentSessionId || !cwd || !tmuxSessionName) {
    fail(
      'INTERNAL',
      'start-shell requires terminalId, deviceId, parentSessionId, cwd, and tmuxSessionName',
    );
  }

  const hasSession = runCapture('tmux', tmuxArgs(['has-session', '-t', tmuxSessionName]));
  if (hasSession.ok) {
    fail('INTERNAL', `tmux session ${tmuxSessionName} already exists`);
  }

  const shellPath = process.env.SHELL || which('bash') || which('sh') || '/bin/bash';
  const cols = Math.max(1, Number(params.cols) || 80);
  const rows = Math.max(1, Number(params.rows) || 24);
  const tmuxResult = runCapture(
    'tmux',
    tmuxArgs([
      'new-session',
      '-d',
      '-s',
      tmuxSessionName,
      '-c',
      cwd,
      '-x',
      String(cols),
      '-y',
      String(rows),
      '--',
      shellPath,
      '-l',
    ]),
    { timeoutMs: 30_000 },
  );
  if (!tmuxResult.ok) {
    fail('INTERNAL', tmuxResult.error || 'tmux new-session failed for shell');
  }

  const startedAt = new Date().toISOString();
  const manifestRow = {
    id: terminalId,
    kind: 'shell',
    runtime: 'tmux',
    projectId,
    deviceId,
    deviceKind: 'ssh',
    hostLabel: typeof params.hostLabel === 'string' ? params.hostLabel : undefined,
    cwd,
    tmuxSessionName,
    command: shellPath,
    args: ['-l'],
    cols,
    rows,
    startedAt,
    shell: {
      parentSessionId,
      worktreePath: cwd,
    },
  };

  const existing = readManifest(deviceId).filter((t) => t.id !== terminalId);
  writeManifest(deviceId, [...existing, manifestRow]);
  emit({ ok: true, data: { terminalId, tmuxSessionName, startedAt } });
}

function runProbeAgent(params) {
  const command = typeof params.command === 'string' ? params.command.trim() : '';
  if (!command) {
    fail('INTERNAL', 'probe-agent requires command');
  }
  const found = Boolean(which(command));
  emit({ ok: true, data: { found, command } });
}

function runListTmuxSessions() {
  const result = runCapture('tmux', tmuxArgs(['list-sessions', '-F', '#{session_name}']));
  if (!result.ok) {
    emit({ ok: true, data: { sessionNames: [] } });
    return;
  }
  const sessionNames = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  emit({ ok: true, data: { sessionNames } });
}

function runPathExists(params) {
  const raw = typeof params.path === 'string' ? params.path.trim() : '';
  if (!raw) {
    fail('INTERNAL', 'path-exists requires path');
  }
  const target = expandHome(raw);
  emit({ ok: true, data: { exists: fs.existsSync(target) } });
}

function runWorktreeRemove(params) {
  const worktreePath = expandHome(
    typeof params.worktreePath === 'string' ? params.worktreePath.trim() : '',
  );
  const repoPath = expandHome(typeof params.repoPath === 'string' ? params.repoPath.trim() : '');
  if (!worktreePath || !repoPath) {
    fail('INTERNAL', 'worktree-remove requires worktreePath and repoPath');
  }
  if (!fs.existsSync(worktreePath)) {
    emit({ ok: true, data: { removed: false, reason: 'not-found' } });
    return;
  }
  const remove = gitRun(['worktree', 'remove', '--force', worktreePath], { cwd: repoPath });
  if (!remove.ok) {
    fail('WORKTREE_FAILED', remove.error || 'git worktree remove failed');
  }
  gitRun(['worktree', 'prune'], { cwd: repoPath });
  emit({ ok: true, data: { removed: true, worktreePath } });
}

function parsePorcelainDirty(statusOutput) {
  let hasStaged = false;
  let hasUnstaged = false;
  let hasUntracked = false;
  for (const line of String(statusOutput || '').split('\n')) {
    if (!line.trim()) continue;
    const indexStatus = line.length > 0 ? line[0] : ' ';
    const workTreeStatus = line.length > 1 ? line[1] : ' ';
    if (indexStatus === '?' && workTreeStatus === '?') {
      hasUntracked = true;
      continue;
    }
    if (indexStatus !== ' ' && indexStatus !== '?') hasStaged = true;
    if (workTreeStatus !== ' ' && workTreeStatus !== '?') hasUnstaged = true;
  }
  return {
    isDirty: hasStaged || hasUnstaged || hasUntracked,
    hasStaged,
    hasUnstaged,
    hasUntracked,
  };
}

function countAheadBehind(gitRoot, branchShort) {
  gitRun(['fetch', 'origin', branchShort], { cwd: gitRoot, timeoutMs: 120_000 });
  const localRef = gitRun(['rev-parse', '--verify', `refs/heads/${branchShort}`], {
    cwd: gitRoot,
  });
  const originRef = gitRun(['rev-parse', '--verify', `refs/remotes/origin/${branchShort}`], {
    cwd: gitRoot,
  });
  if (!localRef.ok) {
    return { ahead: 0, behind: 0, originConfigured: originRef.ok };
  }
  if (!originRef.ok) {
    return { ahead: 0, behind: 0, originConfigured: false };
  }
  const counts = gitRun(
    ['rev-list', '--left-right', '--count', `origin/${branchShort}...${branchShort}`],
    { cwd: gitRoot },
  );
  if (!counts.ok) {
    return { ahead: 0, behind: 0, originConfigured: true };
  }
  const parts = counts.stdout.split(/\s+/).map((x) => Number.parseInt(x, 10));
  const behind = Number.isFinite(parts[0]) ? parts[0] : 0;
  const ahead = Number.isFinite(parts[1]) ? parts[1] : 0;
  return { ahead, behind, originConfigured: true };
}

function runGitSyncStatus(params) {
  const worktreePath =
    typeof params.worktreePath === 'string' ? expandHome(params.worktreePath.trim()) : '';
  const fluxxWorkBranch =
    typeof params.fluxxWorkBranch === 'string' ? params.fluxxWorkBranch.trim() : '';
  const sourceBranchShort =
    typeof params.sourceBranchShort === 'string' ? params.sourceBranchShort.trim() : undefined;
  if (!worktreePath) {
    fail('INTERNAL', 'git-sync-status requires worktreePath');
  }
  if (!fs.existsSync(worktreePath)) {
    fail('WORKSPACE_MISSING', `Worktree path does not exist: ${worktreePath}`);
  }
  const head = gitRun(['rev-parse', 'HEAD'], { cwd: worktreePath });
  if (!head.ok) {
    fail('REMOTE_GIT_MISSING', head.error || 'Could not resolve HEAD in remote worktree');
  }
  const branchResult = gitRun(['symbolic-ref', '--short', 'HEAD'], { cwd: worktreePath });
  const currentBranch = branchResult.ok ? branchResult.stdout.trim() : '';
  const workBranch = fluxxWorkBranch || currentBranch;
  const status = gitRun(['status', '--porcelain'], { cwd: worktreePath });
  if (!status.ok) {
    fail('INTERNAL', status.error || 'git status failed');
  }
  const dirty = parsePorcelainDirty(status.stdout);
  const gitRootResult = gitRun(['rev-parse', '--show-toplevel'], { cwd: worktreePath });
  const gitRoot = gitRootResult.ok ? gitRootResult.stdout.trim() : worktreePath;
  const aheadBehind = workBranch ? countAheadBehind(gitRoot, workBranch) : { ahead: 0, behind: 0, originConfigured: false };
  emit({
    ok: true,
    data: {
      worktreePath,
      currentBranch,
      fluxxWorkBranch: workBranch,
      ...(sourceBranchShort ? { sourceBranchShort } : {}),
      headCommit: head.stdout.trim(),
      isDirty: dirty.isDirty,
      dirtyDetails: dirty,
      aheadOfOrigin: aheadBehind.ahead,
      behindOrigin: aheadBehind.behind,
      originConfigured: aheadBehind.originConfigured,
      remoteHasUnsyncedChanges: dirty.isDirty || aheadBehind.ahead > 0,
      dirtySnapshotHooks: {
        baseCommit: head.stdout.trim(),
        binaryDiffCommand: 'git diff --binary',
        untrackedArchiveSupported: true,
        conflictSafeApplyPlanned: true,
      },
    },
  });
}

function runPushWorkBranch(params) {
  const worktreePath =
    typeof params.worktreePath === 'string' ? expandHome(params.worktreePath.trim()) : '';
  const branch =
    typeof params.fluxxWorkBranch === 'string'
      ? params.fluxxWorkBranch.trim()
      : typeof params.branch === 'string'
        ? params.branch.trim()
        : '';
  if (!worktreePath || !branch) {
    fail('INTERNAL', 'push-work-branch requires worktreePath and fluxxWorkBranch');
  }
  if (!fs.existsSync(worktreePath)) {
    fail('WORKSPACE_MISSING', `Worktree path does not exist: ${worktreePath}`);
  }
  const headBefore = gitRun(['rev-parse', 'HEAD'], { cwd: worktreePath });
  if (!headBefore.ok) {
    fail('REMOTE_GIT_MISSING', headBefore.error || 'Could not resolve HEAD');
  }
  const push = gitRun(['push', 'origin', branch], { cwd: worktreePath, timeoutMs: 300_000 });
  if (!push.ok) {
    fail('REMOTE_PUSH_FAILED', push.error || `git push origin ${branch} failed`);
  }
  const headAfter = gitRun(['rev-parse', 'HEAD'], { cwd: worktreePath });
  emit({
    ok: true,
    data: {
      branch,
      pushed: true,
      headCommit: (headAfter.ok ? headAfter.stdout : headBefore.stdout).trim(),
    },
  });
}

function runMarkTerminalEnded(params) {
  const terminalId = typeof params.terminalId === 'string' ? params.terminalId.trim() : '';
  const deviceId = typeof params.deviceId === 'string' ? params.deviceId.trim() : '';
  const reason =
    typeof params.reason === 'string' && params.reason.trim()
      ? params.reason.trim()
      : 'user-stopped';
  if (!terminalId || !deviceId) {
    fail('INTERNAL', 'mark-terminal-ended requires terminalId and deviceId');
  }
  const rows = readManifest(deviceId);
  const row = rows.find((t) => t.id === terminalId && !t.endedAt);
  if (!row) {
    emit({ ok: true, data: { marked: false, terminalId, reason: 'not-found' } });
    return;
  }
  const endedAt = new Date().toISOString();
  const remaining = rows.map((t) =>
    t.id === terminalId ? { ...t, endedAt, endedReason: reason } : t,
  );
  writeManifest(deviceId, remaining);
  emit({ ok: true, data: { marked: true, terminalId, endedAt, reason } });
}

function main() {
  const command = process.argv[2];
  if (!command) {
    fail('INTERNAL', 'Missing helper command');
  }
  if (command === 'attach-terminal') {
    const terminalId = process.argv[3];
    if (!terminalId || !terminalId.trim()) {
      process.stderr.write('Missing terminal id for attach-terminal\n');
      process.exit(1);
    }
    runAttachTerminal(terminalId.trim());
    return;
  }
  if (!process.argv.includes('--json')) {
    fail('INTERNAL', '--json is required');
  }
  switch (command) {
    case 'version':
      emit({
        ok: true,
        data: {
          version: VERSION,
          features: { worktreeReclaim: true },
        },
      });
      break;
    case 'probe':
      runProbe(readStdinJson());
      break;
    case 'probe-agent':
      runProbeAgent(readStdinJson());
      break;
    case 'repo-ensure':
      runRepoEnsure(readStdinJson());
      break;
    case 'probe-repo-path':
      runProbeRepoPath(readStdinJson());
      break;
    case 'worktree-create':
      runWorktreeCreate(readStdinJson());
      break;
    case 'start-terminal':
      runStartTerminal(readStdinJson());
      break;
    case 'list-terminals':
      runListTerminals(readStdinJson());
      break;
    case 'stop-terminal':
      runStopTerminal(readStdinJson());
      break;
    case 'start-shell':
      runStartShell(readStdinJson());
      break;
    case 'list-tmux-sessions':
      runListTmuxSessions();
      break;
    case 'path-exists':
      runPathExists(readStdinJson());
      break;
    case 'worktree-remove':
      runWorktreeRemove(readStdinJson());
      break;
    case 'mark-terminal-ended':
      runMarkTerminalEnded(readStdinJson());
      break;
    case 'git-sync-status':
      runGitSyncStatus(readStdinJson());
      break;
    case 'push-work-branch':
      runPushWorkBranch(readStdinJson());
      break;
    default:
      fail('INTERNAL', `Unknown helper command: ${command}`);
  }
}

main();
