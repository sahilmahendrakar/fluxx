import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addProjectMcpServersText,
  ensureProjectMcpConfig,
  materializeCursorMcpConfig,
  parseMcpConfigText,
  parseMcpServersPasteText,
  projectMcpConfigPath,
  writeProjectMcpConfigText,
} from './mcpConfig';

describe('mcpConfig', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-mcp-config-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('creates an empty project config for external MCP servers', async () => {
    const result = await ensureProjectMcpConfig(dir);

    expect(result.path).toBe(projectMcpConfigPath(dir));
    expect(result.config.mcpServers).toEqual({});
    await expect(fs.readFile(result.path, 'utf8')).resolves.not.toContain('localhost:47432');
  });

  it('preserves external servers without injecting a Flux server entry', async () => {
    const result = await writeProjectMcpConfigText(
      dir,
      JSON.stringify({
        mcpServers: {
          datadog: {
            command: 'npx',
            args: ['-y', '@datadog/mcp-server'],
          },
          flux: {
            type: 'stdio',
            command: 'wrong',
          },
        },
      }),
    );

    expect(result.config.mcpServers.datadog).toEqual({
      command: 'npx',
      args: ['-y', '@datadog/mcp-server'],
    });
    expect(result.config.mcpServers.flux).toEqual({
      type: 'stdio',
      command: 'wrong',
    });
  });

  it('rejects malformed config shapes', () => {
    expect(() => parseMcpConfigText('{"mcpServers":[]}')).toThrow(
      /mcpServers/,
    );
    expect(() => parseMcpConfigText('{"mcpServers":{"bad":true}}')).toThrow(
      /must be a JSON object/,
    );
  });

  it('accepts provider-style full MCP config paste', () => {
    expect(
      parseMcpServersPasteText(`{
        "mcpServers": {
          "notion": {
            "url": "https://mcp.notion.com/mcp"
          }
        }
      }`),
    ).toEqual({
      mcpServers: {
        notion: {
          type: 'http',
          url: 'https://mcp.notion.com/mcp',
        },
      },
    });
  });

  it('accepts a single server entry paste without outer braces', () => {
    expect(
      parseMcpServersPasteText(`"notion": {
        "url": "https://mcp.notion.com/mcp"
      }`),
    ).toEqual({
      mcpServers: {
        notion: {
          type: 'http',
          url: 'https://mcp.notion.com/mcp',
        },
      },
    });
  });

  it('adds pasted MCP servers to the existing project config', async () => {
    await writeProjectMcpConfigText(
      dir,
      JSON.stringify({
        mcpServers: {
          datadog: { command: 'datadog-mcp' },
        },
      }),
    );

    const result = await addProjectMcpServersText(
      dir,
      `"notion": { "url": "https://mcp.notion.com/mcp" }`,
    );

    expect(result.config.mcpServers.datadog).toEqual({ command: 'datadog-mcp' });
    expect(result.config.mcpServers.notion).toEqual({
      type: 'http',
      url: 'https://mcp.notion.com/mcp',
    });
    expect(result.config.mcpServers.flux).toBeUndefined();
  });

  it('infers SSE transport for URL-only /sse entries', () => {
    expect(
      parseMcpServersPasteText(`"local": {
        "url": "http://localhost:1234/sse"
      }`),
    ).toEqual({
      mcpServers: {
        local: {
          type: 'sse',
          url: 'http://localhost:1234/sse',
        },
      },
    });
  });

  it('merges project MCP servers into Cursor workspace config', async () => {
    const workspace = path.join(dir, 'worktree');
    await fs.mkdir(path.join(workspace, '.cursor'), { recursive: true });
    await fs.writeFile(
      path.join(workspace, '.cursor', 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          repoLocal: { command: 'repo-mcp' },
          datadog: { command: 'old' },
        },
      }),
      'utf8',
    );

    await materializeCursorMcpConfig(workspace, {
      mcpServers: {
        datadog: { command: 'datadog-mcp' },
      },
    });

    const merged = parseMcpConfigText(
      await fs.readFile(path.join(workspace, '.cursor', 'mcp.json'), 'utf8'),
    );
    expect(merged.mcpServers.repoLocal).toEqual({ command: 'repo-mcp' });
    expect(merged.mcpServers.datadog).toEqual({ command: 'datadog-mcp' });
    expect(merged.mcpServers.flux).toBeUndefined();
  });
});
