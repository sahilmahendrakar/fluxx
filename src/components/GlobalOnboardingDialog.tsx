import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, ExternalLink } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import {
  agentProbeResult,
  cliCommandLabel,
  cliProbeStatusLabel,
  GITHUB_CLI_DOWNLOAD_URL,
  GLOBAL_ONBOARDING_AGENT_CLI,
  probeResultByCommand,
} from '../globalOnboarding/agentCliMapping';
import type { CliProbeStatus, GlobalOnboardingCliProbeResult } from '../globalOnboarding/types';
import { AGENTS, type Agent } from '../types';
import { cn } from '@/lib/utils';

type OnboardingStep = 'agents' | 'github';

type FlowPhase = 'loading' | 'hidden' | 'active';

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

function AgentOptionCard(props: {
  agent: Agent;
  label: string;
  probe?: GlobalOnboardingCliProbeResult;
  probeLoading: boolean;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const { label, probe, probeLoading, selected, disabled, onSelect } = props;
  const cliLabel = cliCommandLabel(GLOBAL_ONBOARDING_AGENT_CLI[props.agent]);

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        selected
          ? 'border-primary bg-primary/5 shadow-sm'
          : 'border-border bg-muted/20 hover:bg-muted/40',
        disabled && 'pointer-events-none opacity-60',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
          selected ? 'border-primary bg-primary' : 'border-muted-foreground/40 bg-background',
        )}
      >
        {selected ? <span className="size-1.5 rounded-full bg-primary-foreground" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">{label}</span>
          {probeLoading ? (
            <Skeleton className="h-5 w-20" aria-hidden />
          ) : probe ? (
            <CliProbeStatusBadge status={probe.status} />
          ) : null}
        </span>
        <span className="mt-1 block font-mono text-[11px] text-muted-foreground">{cliLabel}</span>
        {probe?.path ? (
          <span className="mt-1 block truncate font-mono text-[10px] text-muted-foreground" title={probe.path}>
            {probe.path}
          </span>
        ) : null}
        {probe && (probe.status === 'error' || probe.status === 'timeout') && probe.message ? (
          <span className="mt-1 block text-[11px] text-muted-foreground">{probe.message}</span>
        ) : null}
      </span>
    </button>
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
    <div className="flex flex-col gap-3 py-4">
      <div role="radiogroup" aria-label="Starting agent" className="flex flex-col gap-2">
        {AGENTS.map(({ id, label }) => (
          <AgentOptionCard
            key={id}
            agent={id}
            label={label}
            probe={cliProbes ? agentProbeResult(cliProbes, id) : undefined}
            probeLoading={probeLoading}
            selected={selectedAgent === id}
            disabled={probeLoading}
            onSelect={() => onSelectAgent(id)}
          />
        ))}
      </div>
      {probeLoading ? (
        <p className="text-xs text-muted-foreground" role="status">
          Checking installed agent CLIs…
        </p>
      ) : null}
    </div>
  );
}

function GitHubStepBody(props: { ghProbe: GlobalOnboardingCliProbeResult | undefined; probeLoading: boolean }) {
  const { ghProbe, probeLoading } = props;

  if (probeLoading) {
    return (
      <div className="flex flex-col gap-3 py-4" role="status" aria-live="polite">
        <Skeleton className="h-20 w-full rounded-lg" />
        <p className="text-xs text-muted-foreground">Checking for GitHub CLI…</p>
      </div>
    );
  }

  if (!ghProbe) {
    return (
      <Alert variant="destructive" className="my-4">
        <AlertCircle aria-hidden />
        <AlertDescription>Could not check for GitHub CLI.</AlertDescription>
      </Alert>
    );
  }

  if (ghProbe.status === 'found') {
    return (
      <div className="flex flex-col gap-3 py-4">
        <Alert className="border-status-success/30 bg-status-success/10 text-status-success-foreground">
          <CheckCircle2 aria-hidden />
          <AlertDescription>
            GitHub CLI is installed
            {ghProbe.path ? (
              <>
                {' '}
                <span className="font-mono text-[11px]">({ghProbe.path})</span>
              </>
            ) : null}
            .
          </AlertDescription>
        </Alert>
        <p className="text-xs text-muted-foreground">
          Fluxx uses <span className="font-mono">gh</span> for pull requests and repository workflows.
        </p>
      </div>
    );
  }

  if (ghProbe.status === 'missing') {
    return (
      <div className="flex flex-col gap-3 py-4">
        <Alert>
          <AlertCircle aria-hidden />
          <AlertDescription>
            GitHub CLI was not found on your PATH. Install it to enable pull request workflows in Fluxx.
          </AlertDescription>
        </Alert>
        <Button
          type="button"
          variant="link"
          className="h-auto self-start px-0 text-sm"
          onClick={() => void window.electronAPI.openExternalUrl(GITHUB_CLI_DOWNLOAD_URL)}
        >
          Download GitHub CLI
          <ExternalLink data-icon="inline-end" aria-hidden />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 py-4">
      <Alert className="border-status-needs-input/30 bg-status-needs-input/10 text-status-needs-input-foreground">
        <AlertCircle aria-hidden />
        <AlertDescription>
          Could not verify GitHub CLI
          {ghProbe.message ? `: ${ghProbe.message}` : '.'} You can install it later if needed.
        </AlertDescription>
      </Alert>
      <Button
        type="button"
        variant="link"
        className="h-auto self-start px-0 text-sm"
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
  const [step, setStep] = useState<OnboardingStep>('agents');
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
        const firstDetected = AGENTS.find(({ id }) => agentProbeResult(probes, id)?.status === 'found');
        if (firstDetected) {
          setSelectedAgent(firstDetected.id);
        } else if (state.selectedAgent) {
          setSelectedAgent(state.selectedAgent);
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

  const handleAgentContinue = useCallback(async () => {
    if (!selectedAgent) {
      setError('Choose a starting agent to continue.');
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
  }, [selectedAgent]);

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

  const stepNumber = step === 'agents' ? 1 : 2;

  return (
    <Dialog open onOpenChange={() => undefined}>
      <DialogContent
        className="max-w-[min(520px,92vw)] [&>button:last-child]:hidden"
        onPointerDownOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        aria-describedby="global-onboarding-description"
      >
        <DialogHeader>
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Step {stepNumber} of 2
          </p>
          {step === 'agents' ? (
            <>
              <DialogTitle>Choose your starting agent</DialogTitle>
              <DialogDescription id="global-onboarding-description">
                Fluxx detected the agent CLIs below. Pick a default for new tasks and planning, or skip
                for now.
              </DialogDescription>
            </>
          ) : (
            <>
              <DialogTitle>GitHub CLI</DialogTitle>
              <DialogDescription id="global-onboarding-description">
                Pull requests and repo workflows use the GitHub CLI when it is available.
              </DialogDescription>
            </>
          )}
        </DialogHeader>

        {step === 'agents' ? (
          <AgentStepBody
            cliProbes={cliProbes}
            selectedAgent={selectedAgent}
            onSelectAgent={setSelectedAgent}
          />
        ) : (
          <GitHubStepBody ghProbe={ghProbe} probeLoading={cliProbes == null} />
        )}

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <Button type="button" variant="ghost" disabled={busy} onClick={() => void handleSkip()}>
            Skip for now
          </Button>
          <div className="flex items-center gap-2">
            {step === 'agents' ? (
              <Button
                type="button"
                disabled={busy || !selectedAgent || cliProbes == null}
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
              <Button type="button" disabled={busy} onClick={() => void handleFinish()}>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
