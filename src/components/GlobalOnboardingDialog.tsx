import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, CheckCircle2, ChevronLeft, ExternalLink } from 'lucide-react';
import { AgentProviderIcon, GitHubBrandIcon } from './agentProviderIcons';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { MacTitleBarInset } from '@/components/shell/MacTitleBarInset';
import {
  agentInstallLinkLabel,
  agentProbeResult,
  AGENT_INSTALL_URLS,
  cliCommandLabel,
  cliProbeStatusLabel,
  GITHUB_CLI_DOWNLOAD_URL,
  GLOBAL_ONBOARDING_AGENT_CLI,
  isAgentCliInstalled,
  probeResultByCommand,
} from '../globalOnboarding/agentCliMapping';
import type { CliProbeStatus, GlobalOnboardingCliProbeResult } from '../globalOnboarding/types';
import { AGENTS, type Agent } from '../types';
import { cn } from '@/lib/utils';

const ONBOARDING_STEP_COUNT = 3;

/** Flat outline actions — no primary fill. */
const onboardingActionButtonClass =
  'h-9 border-border bg-transparent px-5 font-normal text-foreground shadow-none hover:bg-muted/50';

const onboardingTextButtonClass =
  'h-auto px-0 font-normal text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground';

type OnboardingStep = 'welcome' | 'agents' | 'github';

type FlowPhase = 'loading' | 'hidden' | 'active';

function onboardingStepNumber(step: OnboardingStep): number {
  switch (step) {
    case 'welcome':
      return 1;
    case 'agents':
      return 2;
    case 'github':
      return 3;
  }
}

function previousOnboardingStep(step: OnboardingStep): OnboardingStep | null {
  switch (step) {
    case 'welcome':
      return null;
    case 'agents':
      return 'welcome';
    case 'github':
      return 'agents';
  }
}

function probeStatusBadgeClass(status: CliProbeStatus): string {
  switch (status) {
    case 'found':
      return 'border-status-success/30 bg-status-success/10 text-status-success-foreground';
    case 'missing':
      return 'border-muted-foreground/20 bg-muted/40 text-muted-foreground';
    case 'error':
    case 'timeout':
      return 'border-status-needs-input/30 bg-status-needs-input/10 text-status-needs-input-foreground';
  }
}

function CliProbeStatusBadge({ status }: { status: CliProbeStatus }) {
  return (
    <Badge variant="outline" className={cn('font-normal', probeStatusBadgeClass(status))}>
      {cliProbeStatusLabel(status)}
    </Badge>
  );
}

function WelcomeStepBody() {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="flex max-w-lg flex-col gap-3">
        <h1
          id="global-onboarding-welcome-title"
          className="text-2xl font-medium tracking-tight text-foreground sm:text-3xl"
        >
          Welcome to Fluxx!
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
          Fluxx helps you run AI agents on real codebases—tasks, planning, and terminals in one
          place. In the next steps you will pick a default agent and check for the GitHub CLI.
        </p>
      </div>
    </div>
  );
}

function AgentOptionCard(props: {
  agent: Agent;
  label: string;
  probe?: GlobalOnboardingCliProbeResult;
  probeLoading: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const { label, probe, probeLoading, selected, onSelect } = props;
  const cliLabel = cliCommandLabel(GLOBAL_ONBOARDING_AGENT_CLI[props.agent]);
  const installed = isAgentCliInstalled(probe);
  const selectable = !probeLoading && installed;

  const showInstallLink = !probeLoading && !installed;

  return (
    <div
      className={cn(
        'relative w-full',
        !probeLoading && !installed && 'opacity-50',
      )}
    >
      <button
        type="button"
        role="radio"
        aria-checked={selected && selectable}
        aria-disabled={!selectable}
        disabled={!selectable}
        onClick={onSelect}
        className={cn(
          'flex w-full items-start gap-3 rounded-lg border px-4 py-3.5 text-left transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          selected && selectable
            ? 'border-foreground/50 bg-muted/50 ring-2 ring-foreground/20'
            : 'border-border bg-transparent',
          selectable && !selected && 'hover:bg-muted/30',
          !selectable && 'cursor-not-allowed',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted/25 text-foreground',
            selected && selectable ? 'border-foreground/40' : 'border-border',
          )}
        >
          <AgentProviderIcon agent={props.agent} className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'text-sm text-foreground',
                selected && selectable ? 'font-semibold' : 'font-medium',
              )}
            >
              {label}
            </span>
            {probeLoading ? (
              <Skeleton className="h-5 w-20" aria-hidden />
            ) : probe ? (
              <CliProbeStatusBadge status={probe.status} />
            ) : null}
          </span>
          <span className="mt-1 block font-mono text-[11px] text-muted-foreground">{cliLabel}</span>
          {probe?.path ? (
            <span
              className="mt-1 block truncate font-mono text-[10px] text-muted-foreground"
              title={probe.path}
            >
              {probe.path}
            </span>
          ) : null}
          {probe && (probe.status === 'error' || probe.status === 'timeout') && probe.message ? (
            <span className="mt-1 block text-[11px] text-muted-foreground">{probe.message}</span>
          ) : null}
        </span>
        {selected && selectable ? (
          <span className="flex shrink-0 items-center gap-1 pt-0.5 text-xs font-medium text-foreground">
            <Check className="size-3.5" aria-hidden />
            Selected
          </span>
        ) : null}
      </button>
      {showInstallLink ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            'absolute left-[calc(100%+0.75rem)] top-1/2 z-10 h-auto -translate-y-1/2 whitespace-nowrap px-2 py-1.5 text-xs font-normal',
            onboardingTextButtonClass,
          )}
          onClick={(event) => {
            event.stopPropagation();
            void window.electronAPI.openExternalUrl(AGENT_INSTALL_URLS[props.agent]);
          }}
        >
          {agentInstallLinkLabel(props.agent)}
          <ExternalLink className="size-3 opacity-70" aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}

function AgentStepBody(props: {
  cliProbes: GlobalOnboardingCliProbeResult[] | null;
  selectedAgent: Agent | null;
  onSelectAgent: (agent: Agent) => void;
}) {
  const { cliProbes, selectedAgent, onSelectAgent } = props;
  const probeLoading = cliProbes == null;

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-2 text-center sm:text-left">
        <h1 className="text-2xl font-medium tracking-tight text-foreground sm:text-3xl">
          Choose your starting agent
        </h1>
        <p
          id="global-onboarding-description"
          className="text-sm leading-relaxed text-muted-foreground sm:text-base"
        >
          Fluxx detected the agent CLIs below. Choose an installed agent as your default, or skip
          for now.
        </p>
      </div>
      <div
        role="radiogroup"
        aria-label="Starting agent"
        className="mx-auto flex w-full max-w-md flex-col gap-2"
      >
        {AGENTS.map(({ id, label }) => (
          <AgentOptionCard
            key={id}
            agent={id}
            label={label}
            probe={cliProbes ? agentProbeResult(cliProbes, id) : undefined}
            probeLoading={probeLoading}
            selected={selectedAgent === id}
            onSelect={() => {
              const probe = cliProbes ? agentProbeResult(cliProbes, id) : undefined;
              if (!isAgentCliInstalled(probe)) return;
              onSelectAgent(id);
            }}
          />
        ))}
      </div>
      {probeLoading ? (
        <p className="text-center text-xs text-muted-foreground sm:text-left" role="status">
          Checking installed agent CLIs…
        </p>
      ) : null}
    </div>
  );
}

function GitHubStepHeader() {
  return (
    <div className="flex flex-col gap-2 text-center sm:text-left">
      <div className="flex items-center justify-center gap-3 sm:justify-start">
        <GitHubBrandIcon className="size-7 shrink-0 text-foreground" />
        <h1 className="text-2xl font-medium leading-none tracking-tight text-foreground sm:text-3xl">
          GitHub CLI
        </h1>
      </div>
      <p
        id="global-onboarding-description"
        className="text-sm leading-relaxed text-muted-foreground sm:text-base"
      >
        Pull requests and repo workflows use the GitHub CLI when it is available.
      </p>
    </div>
  );
}

function GitHubStepBody(props: { ghProbe: GlobalOnboardingCliProbeResult | undefined; probeLoading: boolean }) {
  const { ghProbe, probeLoading } = props;
  /** UI-only until GitHub feature prefs are wired in main. */
  const [githubFeaturesEnabled, setGithubFeaturesEnabled] = useState(true);

  const header = <GitHubStepHeader />;

  if (probeLoading) {
    return (
      <div className="flex w-full flex-col gap-6">
        {header}
        <div role="status" aria-live="polite" className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full rounded-lg" />
          <p className="text-xs text-muted-foreground">Checking for GitHub CLI…</p>
        </div>
      </div>
    );
  }

  if (!ghProbe) {
    return (
      <div className="flex w-full flex-col gap-6">
        {header}
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>Could not check for GitHub CLI.</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (ghProbe.status === 'found') {
    return (
      <div className="flex w-full flex-col gap-6">
        {header}
        <div className="flex w-full items-center gap-2">
          <div
            role="alert"
            className="flex min-w-0 flex-1 items-center gap-3 rounded-lg border border-status-success/40 bg-transparent px-4 py-3 text-sm text-status-success-foreground"
          >
            <GitHubBrandIcon className="size-4 shrink-0" aria-hidden />
            <p className="min-w-0 leading-snug">
              GitHub CLI is installed
              {ghProbe.path ? (
                <>
                  {' '}
                  <span className="font-mono text-[11px]">({ghProbe.path})</span>
                </>
              ) : null}
              .
            </p>
          </div>
          <CheckCircle2
            className="size-5 shrink-0 text-status-success"
            aria-hidden
          />
        </div>
        <p className="text-sm text-muted-foreground">
          Fluxx uses <span className="font-mono">gh</span> for pull requests and repository workflows.
        </p>
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-3">
          <Label htmlFor="global-onboarding-github-features" className="cursor-pointer text-sm font-normal">
            Enable GitHub features
          </Label>
          <Switch
            id="global-onboarding-github-features"
            checked={githubFeaturesEnabled}
            onCheckedChange={setGithubFeaturesEnabled}
          />
        </div>
      </div>
    );
  }

  if (ghProbe.status === 'missing') {
    return (
      <div className="flex w-full flex-col gap-6">
        {header}
        <Alert>
          <AlertCircle aria-hidden />
          <AlertDescription>
            GitHub CLI was not found on your PATH. Install it to enable pull request workflows in
            Fluxx.
          </AlertDescription>
        </Alert>
        <Button
          type="button"
          variant="ghost"
          className={cn('self-center text-sm sm:self-start', onboardingTextButtonClass)}
          onClick={() => void window.electronAPI.openExternalUrl(GITHUB_CLI_DOWNLOAD_URL)}
        >
          Download GitHub CLI
          <ExternalLink data-icon="inline-end" aria-hidden />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-6">
      {header}
      <Alert className="border-status-needs-input/30 bg-status-needs-input/10 text-status-needs-input-foreground">
        <AlertCircle aria-hidden />
        <AlertDescription>
          Could not verify GitHub CLI
          {ghProbe.message ? `: ${ghProbe.message}` : '.'} You can install it later if needed.
        </AlertDescription>
      </Alert>
      <Button
        type="button"
        variant="ghost"
        className={cn('self-center text-sm sm:self-start', onboardingTextButtonClass)}
        onClick={() => void window.electronAPI.openExternalUrl(GITHUB_CLI_DOWNLOAD_URL)}
      >
        Download GitHub CLI
        <ExternalLink data-icon="inline-end" aria-hidden />
      </Button>
    </div>
  );
}

export function GlobalOnboardingDialog() {
  const [flowPhase, setFlowPhase] = useState<FlowPhase>('loading');
  const [step, setStep] = useState<OnboardingStep>('welcome');
  const [cliProbes, setCliProbes] = useState<GlobalOnboardingCliProbeResult[] | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const state = await window.electronAPI.globalOnboarding.getState();
        if (cancelled) return;
        if (state.status !== 'pending') {
          setFlowPhase('hidden');
          return;
        }
        setFlowPhase('active');
        const probes = await window.electronAPI.globalOnboarding.probeClis();
        if (cancelled) return;
        setCliProbes(probes);
        const firstDetected = AGENTS.find(({ id }) =>
          isAgentCliInstalled(agentProbeResult(probes, id)),
        );
        const storedInstalled =
          state.selectedAgent &&
          isAgentCliInstalled(agentProbeResult(probes, state.selectedAgent));
        if (storedInstalled) {
          setSelectedAgent(state.selectedAgent!);
        } else if (firstDetected) {
          setSelectedAgent(firstDetected.id);
        } else {
          setSelectedAgent(null);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load onboarding.');
        setFlowPhase('hidden');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const ghProbe = useMemo(
    () => (cliProbes ? probeResultByCommand(cliProbes, 'gh') : undefined),
    [cliProbes],
  );

  const handleSkip = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      await window.electronAPI.globalOnboarding.skip();
      setFlowPhase('hidden');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not skip onboarding.');
    } finally {
      setBusy(false);
    }
  }, []);

  const handleWelcomeContinue = useCallback(() => {
    setError(null);
    setStep('agents');
  }, []);

  const handleBack = useCallback(() => {
    setError(null);
    const prev = previousOnboardingStep(step);
    if (prev) setStep(prev);
  }, [step]);

  const selectedAgentInstalled = useMemo(() => {
    if (!selectedAgent || !cliProbes) return false;
    return isAgentCliInstalled(agentProbeResult(cliProbes, selectedAgent));
  }, [cliProbes, selectedAgent]);

  const handleAgentContinue = useCallback(async () => {
    if (!selectedAgent || !selectedAgentInstalled) {
      setError('Choose an installed agent to continue.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const result = await window.electronAPI.globalOnboarding.selectAgent(selectedAgent);
      if ('error' in result) {
        setError('Could not save your agent choice. Try again or skip for now.');
        return;
      }
      setStep('github');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your agent choice.');
    } finally {
      setBusy(false);
    }
  }, [selectedAgent, selectedAgentInstalled]);

  const handleFinish = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      await window.electronAPI.globalOnboarding.complete();
      setFlowPhase('hidden');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not finish onboarding.');
    } finally {
      setBusy(false);
    }
  }, []);

  if (flowPhase !== 'active') {
    return null;
  }

  const stepNumber = onboardingStepNumber(step);
  const canGoBack = previousOnboardingStep(step) !== null;

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col overflow-hidden bg-background text-foreground"
      role="dialog"
      aria-modal="true"
      aria-labelledby={step === 'welcome' ? 'global-onboarding-welcome-title' : undefined}
      aria-describedby={step !== 'welcome' ? 'global-onboarding-description' : undefined}
    >
      <MacTitleBarInset />

      <main className="app-window-no-drag flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-10">
        <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center">
          {step === 'welcome' ? (
            <WelcomeStepBody />
          ) : step === 'agents' ? (
            <AgentStepBody
              cliProbes={cliProbes}
              selectedAgent={selectedAgent}
              onSelectAgent={setSelectedAgent}
            />
          ) : (
            <GitHubStepBody ghProbe={ghProbe} probeLoading={cliProbes == null} />
          )}

          {error ? (
            <Alert variant="destructive" className="mt-6">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      </main>

      <footer className="app-window-no-drag grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4 px-6 py-5">
        <div className="flex justify-start">
          {canGoBack ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              className={onboardingActionButtonClass}
              onClick={handleBack}
            >
              <ChevronLeft data-icon="inline-start" aria-hidden />
              Back
            </Button>
          ) : null}
        </div>
        <p className="text-center text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Step {stepNumber} of {ONBOARDING_STEP_COUNT}
        </p>
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            className="font-normal text-muted-foreground hover:text-foreground"
            onClick={() => void handleSkip()}
          >
            Skip for now
          </Button>
          {step === 'welcome' ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              className={onboardingActionButtonClass}
              onClick={handleWelcomeContinue}
            >
              Get started
            </Button>
          ) : step === 'agents' ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy || !selectedAgentInstalled || cliProbes == null}
              className={onboardingActionButtonClass}
              onClick={() => void handleAgentContinue()}
            >
              {busy ? (
                <>
                  <Spinner data-icon="inline-start" />
                  Saving…
                </>
              ) : (
                'Continue'
              )}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              className={onboardingActionButtonClass}
              onClick={() => void handleFinish()}
            >
              {busy ? (
                <>
                  <Spinner data-icon="inline-start" />
                  Finishing…
                </>
              ) : (
                'Finish'
              )}
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}
