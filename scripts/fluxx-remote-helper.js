#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const VERSION = '0.2.1';

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
    return {
      ok: false,
      error: `Setup script exited with code ${result.status} (see ${logPath})`,
    };
  }
  return { ok: true };
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

  if (fs.existsSync(worktreePath)) {
    const head = gitRun(['symbolic-ref', '--short', 'HEAD'], { cwd: worktreePath });
    if (head.ok && head.stdout.trim() === branch) {
      writeContextFiles(worktreePath, params.contextFiles);
      const setup = runSetupScript(
        worktreePath,
        params.setupScript,
        params.setupTimeoutMs,
      );
      if (!setup.ok) fail('REMOTE_SETUP_FAILED', setup.error);
      emit({ ok: true, data: { worktreePath, branch } });
      return;
    }
    fail(
      'WORKTREE_FAILED',
      `Worktree path ${worktreePath} exists but is not on branch ${branch}.`,
    );
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
  if (!setup.ok) fail('REMOTE_SETUP_FAILED', setup.error);
  emit({ ok: true, data: { worktreePath, branch } });
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
  emit({ ok: true, data: { terminals: readManifest(deviceId) } });
}

function runProbeAgent(params) {
  const command = typeof params.command === 'string' ? params.command.trim() : '';
  if (!command) {
    fail('INTERNAL', 'probe-agent requires command');
  }
  const found = Boolean(which(command));
  emit({ ok: true, data: { found, command } });
}

function main() {
  if (!process.argv.includes('--json')) {
    fail('INTERNAL', '--json is required');
  }
  const command = process.argv[2];
  if (!command) {
    fail('INTERNAL', 'Missing helper command');
  }
  switch (command) {
    case 'version':
      emit({ ok: true, data: { version: VERSION } });
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
    case 'worktree-create':
      runWorktreeCreate(readStdinJson());
      break;
    case 'start-terminal':
      runStartTerminal(readStdinJson());
      break;
    case 'list-terminals':
      runListTerminals(readStdinJson());
      break;
    default:
      fail('INTERNAL', `Unknown helper command: ${command}`);
  }
}

main();
