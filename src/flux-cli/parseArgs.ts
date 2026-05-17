export type FluxCliCommand =
  | { kind: 'project'; action: 'info'; json: boolean }
  | { kind: 'tasks'; action: 'list'; json: boolean; excludeStatuses?: string[] }
  | { kind: 'tasks'; action: 'create'; json: boolean; payload: Record<string, unknown> }
  | { kind: 'tasks'; action: 'update'; json: boolean; payload: Record<string, unknown> }
  | { kind: 'tasks'; action: 'start'; json: boolean; id: string }
  | { kind: 'tasks'; action: 'delete'; json: boolean; id: string; confirm: boolean }
  | { kind: 'members'; action: 'list'; json: boolean }
  | { kind: 'repo'; action: 'branches'; json: boolean; repoId?: string; classifyBranch?: string };

export type FluxCliParseResult =
  | { ok: true; command: FluxCliCommand }
  | { ok: false; message: string };

function takeFlag(argv: string[], name: string): { value?: string; rest: string[] } {
  const out: string[] = [];
  let value: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === name) {
      const next = argv[i + 1];
      if (next == null || next.startsWith('-')) {
        return { rest: [] };
      }
      value = next;
      i += 1;
      continue;
    }
    if (a.startsWith(`${name}=`)) {
      value = a.slice(name.length + 1);
      continue;
    }
    out.push(a);
  }
  return { value, rest: out };
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function collectRepeatedFlag(argv: string[], name: string): { values: string[]; rest: string[] } {
  const values: string[] = [];
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === name) {
      const next = argv[i + 1];
      if (next != null && !next.startsWith('-')) {
        values.push(next);
        i += 1;
      }
      continue;
    }
    if (a.startsWith(`${name}=`)) {
      values.push(a.slice(name.length + 1));
      continue;
    }
    rest.push(a);
  }
  return { values, rest };
}

function collectRepeatedFlags(argv: string[], names: string[]): { values: string[]; rest: string[] } {
  const nameSet = new Set(names);
  const values: string[] = [];
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (nameSet.has(a)) {
      const next = argv[i + 1];
      if (next != null && !next.startsWith('-')) {
        values.push(next);
        i += 1;
      }
      continue;
    }
    const eq = a.indexOf('=');
    if (eq > 0 && nameSet.has(a.slice(0, eq))) {
      values.push(a.slice(eq + 1));
      continue;
    }
    rest.push(a);
  }
  return { values, rest };
}

function takeFlagAliases(argv: string[], names: string[]): { value?: string; rest: string[] } {
  const nameSet = new Set(names);
  let value: string | undefined;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (nameSet.has(a)) {
      const next = argv[i + 1];
      if (next == null || next.startsWith('-')) {
        return { rest: [] };
      }
      value = next;
      i += 1;
      continue;
    }
    const eq = a.indexOf('=');
    if (eq > 0 && nameSet.has(a.slice(0, eq))) {
      value = a.slice(eq + 1);
      continue;
    }
    rest.push(a);
  }
  return { value, rest };
}

function splitListValues(values: string[]): string[] {
  return values
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function parseKeyValuePayload(argv: string[]): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') continue;
    if (a.startsWith('--') && a.includes('=')) {
      const eq = a.indexOf('=');
      const key = a.slice(2, eq).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      const raw = a.slice(eq + 1);
      payload[key] = coerceScalar(raw);
      continue;
    }
    if (a.startsWith('--')) {
      const key = a.slice(2).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      const next = argv[i + 1];
      if (next != null && !next.startsWith('-')) {
        payload[key] = coerceScalar(next);
        i += 1;
      } else {
        payload[key] = true;
      }
    }
  }
  return payload;
}

function coerceScalar(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  return raw;
}

type TaskPayloadParseResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; message: string };

function parseTaskPayload(argv: string[]): TaskPayloadParseResult {
  const { values: labelsRaw, rest: withoutLabels } = collectRepeatedFlags(argv, [
    '--label',
    '--labels',
    '--feature-label',
    '--feature-labels',
  ]);
  const { values: blockedByRaw, rest: withoutBlockedBy } = collectRepeatedFlags(withoutLabels, [
    '--blocked-by-task-id',
    '--blocked-by-task-ids',
    '--blocked-by',
    '--depends-on-task-id',
    '--depends-on-task-ids',
    '--depends-on',
  ]);
  const { value: repoId, rest: withoutRepo } = takeFlagAliases(withoutBlockedBy, [
    '--repo-id',
    '--repo',
  ]);
  const { value: sourceBranch, rest: withoutSourceBranch } = takeFlagAliases(withoutRepo, [
    '--source-branch',
    '--feature-branch',
    '--branch',
  ]);
  const { values: attachDocRaw, rest: withoutAttachDoc } = collectRepeatedFlags(withoutSourceBranch, [
    '--attach-doc',
    '--attach-docs',
    '--attach-planning-doc',
  ]);

  const payload = parseKeyValuePayload(withoutAttachDoc);
  const labels = splitListValues(labelsRaw);
  const blockedByTaskIds = splitListValues(blockedByRaw);
  const attachDocPaths = splitListValues(attachDocRaw);
  const clearLabels = payload.clearLabels === true;
  const clearBlockedBy =
    payload.clearBlockedBy === true ||
    payload.clearBlockedByTaskIds === true ||
    payload.clearDependencies === true;
  const clearAttachedDocs =
    payload.clearAttachedDocs === true || payload.clearAttachDocs === true;

  if (clearLabels && labels.length > 0) {
    return { ok: false, message: 'Pass either --label/--labels or --clear-labels, not both' };
  }
  if (clearBlockedBy && blockedByTaskIds.length > 0) {
    return {
      ok: false,
      message: 'Pass either dependency flags or --clear-dependencies, not both',
    };
  }
  if (clearAttachedDocs && attachDocPaths.length > 0) {
    return {
      ok: false,
      message: 'Pass either --attach-doc/--attach-docs or --clear-attached-docs, not both',
    };
  }

  delete payload.clearLabels;
  delete payload.clearBlockedBy;
  delete payload.clearBlockedByTaskIds;
  delete payload.clearDependencies;
  delete payload.clearAttachedDocs;
  delete payload.clearAttachDocs;
  if (labels.length > 0 || clearLabels) payload.labels = labels;
  if (blockedByTaskIds.length > 0 || clearBlockedBy) payload.blockedByTaskIds = blockedByTaskIds;
  if (attachDocPaths.length > 0) {
    payload.attachedPlanningDocs = attachDocPaths.map((relativePath) => ({ relativePath }));
  } else if (clearAttachedDocs) {
    payload.attachedPlanningDocs = null;
  }
  if (repoId !== undefined) payload.repoId = repoId;
  if (sourceBranch !== undefined) payload.sourceBranch = sourceBranch;
  return { ok: true, payload };
}

export function parseFluxCliArgs(argv: string[]): FluxCliParseResult {
  const json = hasFlag(argv, '--json');
  const positional = argv.filter((a) => a !== '--json');
  if (positional.length === 0) {
    return { ok: false, message: 'Usage: flux <project|tasks|members|repo> ...' };
  }

  const [domain, action, ...rest] = positional;
  if (domain === 'project' && action === 'info') {
    if (rest.length > 0) {
      return { ok: false, message: 'Unexpected arguments for project info' };
    }
    return { ok: true, command: { kind: 'project', action: 'info', json } };
  }

  if (domain === 'members' && action === 'list') {
    if (rest.length > 0) {
      return { ok: false, message: 'Unexpected arguments for members list' };
    }
    return { ok: true, command: { kind: 'members', action: 'list', json } };
  }

  if (domain === 'repo' && action === 'branches') {
    const { value: repoId, rest: r1 } = takeFlag(rest, '--repo-id');
    const { value: classifyBranch, rest: r2 } = takeFlag(r1, '--classify-branch');
    if (r2.length > 0) {
      return { ok: false, message: 'Unexpected arguments for repo branches' };
    }
    return {
      ok: true,
      command: {
        kind: 'repo',
        action: 'branches',
        json,
        ...(repoId !== undefined ? { repoId } : {}),
        ...(classifyBranch !== undefined ? { classifyBranch } : {}),
      },
    };
  }

  if (domain === 'tasks') {
    if (action === 'list') {
      const { values: excludeStatuses, rest: r } = collectRepeatedFlag(rest, '--exclude-status');
      if (r.length > 0) {
        return { ok: false, message: 'Unexpected arguments for tasks list' };
      }
      return {
        ok: true,
        command: {
          kind: 'tasks',
          action: 'list',
          json,
          ...(excludeStatuses.length > 0 ? { excludeStatuses } : {}),
        },
      };
    }
    if (action === 'create') {
      const parsedPayload = parseTaskPayload(rest);
      if (!parsedPayload.ok) return parsedPayload;
      const { payload } = parsedPayload;
      if (typeof payload.title !== 'string' || payload.title.trim() === '') {
        return { ok: false, message: 'tasks create requires --title' };
      }
      return { ok: true, command: { kind: 'tasks', action: 'create', json, payload } };
    }
    if (action === 'update') {
      const parsedPayload = parseTaskPayload(rest);
      if (!parsedPayload.ok) return parsedPayload;
      const { payload } = parsedPayload;
      const id = payload.id ?? payload.taskId;
      if (typeof id !== 'string') {
        return { ok: false, message: 'tasks update requires --id' };
      }
      payload.id = id;
      delete payload.taskId;
      return { ok: true, command: { kind: 'tasks', action: 'update', json, payload } };
    }
    if (action === 'start') {
      const { value: id, rest: r } = takeFlag(rest, '--id');
      if (!id || r.length > 0) {
        return { ok: false, message: 'tasks start requires --id' };
      }
      return { ok: true, command: { kind: 'tasks', action: 'start', json, id } };
    }
    if (action === 'delete') {
      const { value: id, rest: r1 } = takeFlag(rest, '--id');
      const confirm = hasFlag(r1, '--confirm');
      const r = r1.filter((a) => a !== '--confirm');
      if (!id || !confirm || r.length > 0) {
        return { ok: false, message: 'tasks delete requires --id and --confirm' };
      }
      return { ok: true, command: { kind: 'tasks', action: 'delete', json, id, confirm: true } };
    }
  }

  return {
    ok: false,
    message:
      'Unknown command. Try: fluxx project info, fluxx tasks list|create|update|start|delete, fluxx members list, fluxx repo branches',
  };
}
