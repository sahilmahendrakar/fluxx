import { useCallback, useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { SettingsSwitch } from './SettingsSwitch';
import {
  isSavedValidationPackConfigConfigured,
  validationConfigFormDraftFromPlaceholders,
  validationConfigFormDraftFromSaved,
  validationConfigFormDraftToPackConfig,
  type ValidationConfigFormDraft,
} from '../validationPacks/validationConfigForm';
import type { ElectronPlaywrightPackProjectConfig } from '../validationPacks/types';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const ELECTRON_PLAYWRIGHT_PACK_ID = 'electron-playwright' as const;

type Props = {
  projectId: string;
  validationEnabled: boolean;
};

export function ValidationConfigSettingsSection({ projectId, validationEnabled }: Props) {
  const launchCommandId = useId();
  const readyTypeId = useId();
  const readySelectorValueId = useId();
  const readySelectorTimeoutId = useId();
  const readyTimeoutId = useId();
  const appendPromptId = useId();
  const cleanUserDataId = useId();

  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [resetState, setResetState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [configPath, setConfigPath] = useState('');
  const [isConfigured, setIsConfigured] = useState(false);
  const [draft, setDraft] = useState<ValidationConfigFormDraft>(() =>
    validationConfigFormDraftFromPlaceholders(),
  );

  const applyLoadedConfig = useCallback(
    (config: ElectronPlaywrightPackProjectConfig | undefined, path: string) => {
      setConfigPath(path);
      const configured = isSavedValidationPackConfigConfigured(config);
      setIsConfigured(configured);
      setDraft(
        configured && config ? validationConfigFormDraftFromSaved(config) : validationConfigFormDraftFromPlaceholders(),
      );
    },
    [],
  );

  useEffect(() => {
    if (!validationEnabled) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setSaveState('idle');
    setResetState('idle');

    void window.electronAPI.validationPacks
      .getProjectConfig(ELECTRON_PLAYWRIGHT_PACK_ID)
      .then((result) => {
        if (cancelled) return;
        if ('error' in result) {
          setError(result.error);
          return;
        }
        applyLoadedConfig(result.config, result.path);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [applyLoadedConfig, projectId, validationEnabled]);

  const handleSave = useCallback(async () => {
    setSaveState('saving');
    setError(null);
    try {
      const config = validationConfigFormDraftToPackConfig(draft);
      const result = await window.electronAPI.validationPacks.saveProjectConfig({
        packId: ELECTRON_PLAYWRIGHT_PACK_ID,
        config,
      });
      if ('error' in result) {
        setSaveState('error');
        setError(result.error);
        return;
      }
      applyLoadedConfig(result.config, result.path);
      setSaveState('saved');
      window.setTimeout(() => {
        setSaveState((state) => (state === 'saved' ? 'idle' : state));
      }, 1500);
    } catch (err) {
      setSaveState('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [applyLoadedConfig, draft]);

  const handleReset = useCallback(async () => {
    setResetState('saving');
    setError(null);
    try {
      const result = await window.electronAPI.validationPacks.clearProjectConfig(
        ELECTRON_PLAYWRIGHT_PACK_ID,
      );
      if ('error' in result) {
        setResetState('error');
        setError(result.error);
        return;
      }
      applyLoadedConfig(result.config, result.path);
      setResetState('saved');
      window.setTimeout(() => {
        setResetState((state) => (state === 'saved' ? 'idle' : state));
      }, 1500);
    } catch (err) {
      setResetState('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [applyLoadedConfig]);

  if (!validationEnabled) return null;

  const busy = loading || saveState === 'saving' || resetState === 'saving';

  return (
    <div className="py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-medium text-foreground">Electron Playwright validation</h3>
          <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
            Optional launch settings for validator runs. Saving config makes runs repeatable; when
            empty, the validator agent infers how to start the app from{' '}
            <code className="text-muted-foreground">package.json</code> — validation is not blocked.
          </p>
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            Example for Flux: <code className="text-muted-foreground">pnpm start:aux</code>
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
            isConfigured
              ? 'border-emerald-500/30 bg-emerald-500/[0.08] text-status-success'
              : 'border-border bg-muted text-muted-foreground'
          }`}
        >
          {isConfigured
            ? 'Configured'
            : 'Not configured — validator will infer from package.json'}
        </span>
      </div>

      {configPath ? (
        <p className="mt-2 truncate font-mono text-[10px] text-muted-foreground" title={configPath}>
          {configPath}
        </p>
      ) : null}

      <div className="mt-4 space-y-4 rounded-lg border border-border bg-muted/30 p-3">
        <div className="space-y-1.5">
          <Label htmlFor={launchCommandId} className="text-[11px]">
            Launch command
          </Label>
          <Input
            id={launchCommandId}
            value={draft.launchCommand}
            onChange={(e) => {
              setDraft((prev) => ({ ...prev, launchCommand: e.target.value }));
              if (saveState !== 'saving') {
                setSaveState('idle');
                setError(null);
              }
            }}
            disabled={busy}
            placeholder="pnpm start:aux"
            className="h-8 font-mono text-[12px]"
          />
          <p className="text-[10px] text-muted-foreground">
            Dev command the validator should spawn before Playwright checks. Optional but recommended
            for repeatable runs.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={readyTypeId} className="text-[11px]">
              Ready condition type
            </Label>
            <Select
              value={draft.readyType}
              onValueChange={(value: 'selector' | 'timeout') => {
                setDraft((prev) => ({ ...prev, readyType: value }));
                if (saveState !== 'saving') {
                  setSaveState('idle');
                  setError(null);
                }
              }}
              disabled={busy}
            >
              <SelectTrigger id={readyTypeId} className="h-8 text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="selector" className="text-[12px]">
                  Selector
                </SelectItem>
                <SelectItem value="timeout" className="text-[12px]">
                  Timeout
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {draft.readyType === 'selector' ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor={readySelectorValueId} className="text-[11px]">
                  Ready selector
                </Label>
                <Input
                  id={readySelectorValueId}
                  value={draft.readySelectorValue}
                  onChange={(e) => {
                    setDraft((prev) => ({ ...prev, readySelectorValue: e.target.value }));
                    if (saveState !== 'saving') {
                      setSaveState('idle');
                      setError(null);
                    }
                  }}
                  disabled={busy}
                  placeholder="[data-testid='app-shell']"
                  className="h-8 font-mono text-[12px]"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor={readySelectorTimeoutId} className="text-[11px]">
                  Ready timeout (ms)
                </Label>
                <Input
                  id={readySelectorTimeoutId}
                  inputMode="numeric"
                  value={draft.readySelectorTimeoutMs}
                  onChange={(e) => {
                    setDraft((prev) => ({ ...prev, readySelectorTimeoutMs: e.target.value }));
                    if (saveState !== 'saving') {
                      setSaveState('idle');
                      setError(null);
                    }
                  }}
                  disabled={busy}
                  placeholder="120000"
                  className="h-8 font-mono text-[12px]"
                />
              </div>
            </>
          ) : (
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor={readyTimeoutId} className="text-[11px]">
                Ready timeout (ms)
              </Label>
              <Input
                id={readyTimeoutId}
                inputMode="numeric"
                value={draft.readyTimeoutMs}
                onChange={(e) => {
                  setDraft((prev) => ({ ...prev, readyTimeoutMs: e.target.value }));
                  if (saveState !== 'saving') {
                    setSaveState('idle');
                    setError(null);
                  }
                }}
                disabled={busy}
                placeholder="120000"
                className="h-8 font-mono text-[12px]"
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 rounded-md border border-border/70 bg-background/50 px-3 py-2">
          <div>
            <Label id={cleanUserDataId} htmlFor={cleanUserDataId} className="text-[11px]">
              Clean user data
            </Label>
            <p className="text-[10px] text-muted-foreground">
              Launch Electron with an isolated user-data directory for each validation run.
            </p>
          </div>
          <SettingsSwitch
            checked={draft.cleanUserData}
            onCheckedChange={(next) => {
              setDraft((prev) => ({ ...prev, cleanUserData: next }));
              if (saveState !== 'saving') {
                setSaveState('idle');
                setError(null);
              }
            }}
            disabled={busy}
            ariaLabelledBy={cleanUserDataId}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={appendPromptId} className="text-[11px]">
            Append prompt
          </Label>
          <Textarea
            id={appendPromptId}
            value={draft.appendPrompt}
            onChange={(e) => {
              setDraft((prev) => ({ ...prev, appendPrompt: e.target.value }));
              if (saveState !== 'saving') {
                setSaveState('idle');
                setError(null);
              }
            }}
            disabled={busy}
            placeholder="Optional notes appended to every validator session prompt as Project validation notes."
            className="min-h-[96px] resize-y font-mono text-[11px] leading-relaxed"
          />
          <p className="text-[10px] text-muted-foreground">
            Free text saved project-wide. When set, Fluxx adds a{' '}
            <span className="font-medium text-foreground">Project validation notes</span> block to
            every validator session prompt. Leave empty to skip.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void handleReset()}
          >
            {resetState === 'saving' ? 'Resetting…' : 'Reset'}
          </Button>
          <Button type="button" size="sm" disabled={busy} onClick={() => void handleSave()}>
            {saveState === 'saving' ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      <div className="mt-2 min-h-4 text-[11px]">
        {loading ? (
          <span className="text-muted-foreground">Loading…</span>
        ) : saveState === 'saving' ? (
          <span className="text-muted-foreground">Saving…</span>
        ) : saveState === 'saved' ? (
          <span className="text-status-success">Saved</span>
        ) : resetState === 'saving' ? (
          <span className="text-muted-foreground">Resetting…</span>
        ) : resetState === 'saved' ? (
          <span className="text-status-success">Reset — validator will infer from package.json</span>
        ) : error ? (
          <span className="text-destructive">{error}</span>
        ) : null}
      </div>
    </div>
  );
}
