import fs from 'node:fs/promises';
import path from 'node:path';

export const PROJECT_MCP_CONFIG_BASENAME = 'mcp.json';
export const FLUX_MCP_SERVER_NAME = 'flux';
export const FLUX_SSE_MCP_ENTRY = {
  type: 'sse' as const,
  url: 'http://localhost:47432/sse',
};

export interface McpConfig {
  mcpServers: Record<string, unknown>;
}

export interface ProjectMcpConfigPayload {
  path: string;
  text: string;
  config: McpConfig;
}

function errnoCode(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'code' in err
    ? (err as NodeJS.ErrnoException).code
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeMcpServerForCompatibility(server: Record<string, unknown>): Record<string, unknown> {
  if (typeof server.type === 'string' || typeof server.url !== 'string') {
    return server;
  }
  let pathname = '';
  try {
    pathname = new URL(server.url).pathname;
  } catch {
    pathname = '';
  }
  return {
    type: pathname.endsWith('/sse') ? 'sse' : 'http',
    ...server,
  };
}

export function projectMcpConfigPath(projectDir: string): string {
  return path.join(projectDir, PROJECT_MCP_CONFIG_BASENAME);
}

export function parseMcpConfigText(raw: string): McpConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid MCP config JSON: ${message}`);
  }
  return normalizeMcpConfig(parsed);
}

function normalizeMcpServersRecord(servers: unknown, sourceLabel: string): McpConfig {
  if (!isRecord(servers)) {
    throw new Error(`${sourceLabel} must be a JSON object.`);
  }
  const normalized: Record<string, unknown> = {};
  for (const [name, server] of Object.entries(servers)) {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error('MCP server names cannot be empty.');
    }
    if (!isRecord(server)) {
      throw new Error(`MCP server "${trimmed}" must be a JSON object.`);
    }
    normalized[trimmed] = normalizeMcpServerForCompatibility(server);
  }
  return { mcpServers: normalized };
}

export function normalizeMcpConfig(value: unknown): McpConfig {
  if (!isRecord(value)) {
    throw new Error('MCP config must be a JSON object.');
  }
  const servers = value.mcpServers;
  if (!isRecord(servers)) {
    throw new Error('MCP config must contain an object field named "mcpServers".');
  }
  return normalizeMcpServersRecord(servers, 'mcpServers');
}

export function parseMcpServersPasteText(raw: string): McpConfig {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Paste an MCP server config first.');
  }

  const parseUnknown = (text: string): unknown => {
    try {
      return JSON.parse(text) as unknown;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Invalid MCP config JSON: ${message}`);
    }
  };

  const normalizePasteValue = (value: unknown): McpConfig => {
    if (!isRecord(value)) {
      throw new Error('MCP paste must be a JSON object.');
    }
    if ('mcpServers' in value) {
      return normalizeMcpConfig(value);
    }
    return normalizeMcpServersRecord(value, 'MCP server entries');
  };

  try {
    return normalizePasteValue(parseUnknown(trimmed));
  } catch (firstErr) {
    if (trimmed.startsWith('{')) {
      throw firstErr;
    }
    return normalizePasteValue(parseUnknown(`{${trimmed}}`));
  }
}

export function withFluxMcpServer(config: McpConfig): McpConfig {
  return {
    mcpServers: {
      ...config.mcpServers,
      [FLUX_MCP_SERVER_NAME]: FLUX_SSE_MCP_ENTRY,
    },
  };
}

export function defaultMcpConfig(): McpConfig {
  return withFluxMcpServer({ mcpServers: {} });
}

export function formatMcpConfig(config: McpConfig): string {
  return `${JSON.stringify(withFluxMcpServer(config), null, 2)}\n`;
}

export async function ensureProjectMcpConfigExists(projectDir: string): Promise<void> {
  const mcpPath = projectMcpConfigPath(projectDir);
  try {
    await fs.access(mcpPath);
  } catch (err: unknown) {
    if (errnoCode(err) === 'ENOENT') {
      await fs.writeFile(mcpPath, formatMcpConfig(defaultMcpConfig()), 'utf8');
      return;
    }
    throw err;
  }
}

export async function ensureProjectMcpConfig(
  projectDir: string,
): Promise<ProjectMcpConfigPayload> {
  const mcpPath = projectMcpConfigPath(projectDir);
  let config: McpConfig;
  try {
    const raw = await fs.readFile(mcpPath, 'utf8');
    config = parseMcpConfigText(raw);
  } catch (err: unknown) {
    if (errnoCode(err) !== 'ENOENT') {
      throw err;
    }
    config = defaultMcpConfig();
  }
  const merged = withFluxMcpServer(config);
  const text = formatMcpConfig(merged);
  await fs.writeFile(mcpPath, text, 'utf8');
  return { path: mcpPath, text, config: merged };
}

export async function writeProjectMcpConfigText(
  projectDir: string,
  raw: string,
): Promise<ProjectMcpConfigPayload> {
  const mcpPath = projectMcpConfigPath(projectDir);
  const config = withFluxMcpServer(parseMcpConfigText(raw));
  const text = formatMcpConfig(config);
  await fs.writeFile(mcpPath, text, 'utf8');
  return { path: mcpPath, text, config };
}

export async function addProjectMcpServersText(
  projectDir: string,
  raw: string,
): Promise<ProjectMcpConfigPayload> {
  const existing = await ensureProjectMcpConfig(projectDir);
  const additions = parseMcpServersPasteText(raw);
  const config = withFluxMcpServer({
    mcpServers: {
      ...existing.config.mcpServers,
      ...additions.mcpServers,
    },
  });
  const text = formatMcpConfig(config);
  await fs.writeFile(existing.path, text, 'utf8');
  return { path: existing.path, text, config };
}

export async function materializeCursorMcpConfig(
  workspaceDir: string,
  projectConfig: McpConfig,
): Promise<string> {
  const cursorDir = path.join(workspaceDir, '.cursor');
  await fs.mkdir(cursorDir, { recursive: true });
  const targetPath = path.join(cursorDir, PROJECT_MCP_CONFIG_BASENAME);
  let existing: McpConfig = { mcpServers: {} };
  try {
    existing = parseMcpConfigText(await fs.readFile(targetPath, 'utf8'));
  } catch (err: unknown) {
    if (errnoCode(err) !== 'ENOENT') {
      throw err;
    }
  }
  const merged = withFluxMcpServer({
    mcpServers: {
      ...existing.mcpServers,
      ...projectConfig.mcpServers,
    },
  });
  await fs.writeFile(targetPath, formatMcpConfig(merged), 'utf8');
  return targetPath;
}
