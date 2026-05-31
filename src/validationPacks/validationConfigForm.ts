import { ELECTRON_PLAYWRIGHT_VALIDATION_CONFIG_UI_PLACEHOLDERS } from './validationConfigUiPlaceholders';
import type { ElectronPlaywrightPackProjectConfig } from './types';

export type ValidationConfigFormDraft = {
  launchCommand: string;
  readyType: 'selector' | 'timeout';
  readySelectorValue: string;
  readySelectorTimeoutMs: string;
  readyTimeoutMs: string;
  cleanUserData: boolean;
  appendPrompt: string;
};

function parsePositiveInt(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return undefined;
  return n;
}

export function validationConfigFormDraftFromPlaceholders(): ValidationConfigFormDraft {
  const placeholders = ELECTRON_PLAYWRIGHT_VALIDATION_CONFIG_UI_PLACEHOLDERS;
  const ready = placeholders.ready;
  return {
    launchCommand: placeholders.launchCommand,
    readyType: ready.type,
    readySelectorValue: ready.type === 'selector' ? ready.value : '',
    readySelectorTimeoutMs:
      ready.type === 'selector' && typeof ready.timeoutMs === 'number'
        ? String(ready.timeoutMs)
        : '120000',
    readyTimeoutMs: '120000',
    cleanUserData: placeholders.cleanUserData,
    appendPrompt: '',
  };
}

export function validationConfigFormDraftFromSaved(
  config: ElectronPlaywrightPackProjectConfig,
): ValidationConfigFormDraft {
  const draft = validationConfigFormDraftFromPlaceholders();
  if (typeof config.launchCommand === 'string') {
    draft.launchCommand = config.launchCommand;
  }
  if (config.ready?.type === 'selector') {
    draft.readyType = 'selector';
    draft.readySelectorValue = config.ready.value;
    if (typeof config.ready.timeoutMs === 'number') {
      draft.readySelectorTimeoutMs = String(config.ready.timeoutMs);
    }
  } else if (config.ready?.type === 'timeout') {
    draft.readyType = 'timeout';
    draft.readyTimeoutMs = String(config.ready.ms);
  }
  if (config.cleanUserData === true) {
    draft.cleanUserData = true;
  } else if (config.cleanUserData === false) {
    draft.cleanUserData = false;
  }
  if (typeof config.appendPrompt === 'string') {
    draft.appendPrompt = config.appendPrompt;
  }
  return draft;
}

export function validationConfigFormDraftToPackConfig(
  draft: ValidationConfigFormDraft,
): ElectronPlaywrightPackProjectConfig {
  const out: ElectronPlaywrightPackProjectConfig = {};
  const launchCommand = draft.launchCommand.trim();
  if (launchCommand) out.launchCommand = launchCommand;

  if (draft.readyType === 'selector') {
    const value = draft.readySelectorValue.trim();
    if (value) {
      out.ready = { type: 'selector', value };
      const timeoutMs = parsePositiveInt(draft.readySelectorTimeoutMs);
      if (timeoutMs !== undefined) {
        out.ready.timeoutMs = timeoutMs;
      }
    }
  } else {
    const ms = parsePositiveInt(draft.readyTimeoutMs);
    if (ms !== undefined) {
      out.ready = { type: 'timeout', ms };
    }
  }

  if (draft.cleanUserData) out.cleanUserData = true;

  const appendPrompt = draft.appendPrompt.trim();
  if (appendPrompt) out.appendPrompt = appendPrompt;

  return out;
}

export function isSavedValidationPackConfigConfigured(
  config: ElectronPlaywrightPackProjectConfig | undefined,
): boolean {
  return config !== undefined && Object.keys(config).length > 0;
}
