import type { ValidationPackDefinition, ValidationPackResolvedInstructions } from './types';
import type { ElectronPlaywrightPackProjectConfig } from './types';

function formatProjectConfigSection(config?: ElectronPlaywrightPackProjectConfig): string {
  if (!config || Object.keys(config).length === 0) {
    return '_No project `validation-packs.json` overrides. Use worktree defaults or pack examples._\n';
  }
  return `\`\`\`json\n${JSON.stringify({ packs: { 'electron-playwright': config } }, null, 2)}\n\`\`\`\n`;
}

/**
 * Markdown instructions for a validator session: manifest summary, project config, and full skill.
 */
export function buildValidationPackInstructions(
  pack: ValidationPackDefinition,
  projectConfig?: ElectronPlaywrightPackProjectConfig,
): string {
  const { manifest, skillMarkdown, verdictSchemaJson } = pack;
  const lines = [
    `# ${manifest.displayName} validation instructions`,
    '',
    manifest.description,
    '',
    '## Pack defaults',
    '',
    manifest.defaultInstructions,
    '',
    '## Project configuration',
    '',
    'Loaded from `<fluxxProjectDir>/validation-packs.json` when present:',
    '',
    formatProjectConfigSection(projectConfig),
    '',
    '## Verdict contract',
    '',
    'Write `verdict.json` at the run root. Schema:',
    '',
    '```json',
    verdictSchemaJson.trim(),
    '```',
    '',
    '## Validator skill',
    '',
    skillMarkdown.trim(),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

export function resolveValidationPackInstructions(
  pack: ValidationPackDefinition,
  projectConfig?: ElectronPlaywrightPackProjectConfig,
): ValidationPackResolvedInstructions {
  return {
    packId: pack.manifest.id,
    displayName: pack.manifest.displayName,
    instructionsMarkdown: buildValidationPackInstructions(pack, projectConfig),
    verdictSchemaJson: pack.verdictSchemaJson,
    skillMarkdown: pack.skillMarkdown,
    ...(projectConfig ? { projectConfig } : {}),
  };
}
