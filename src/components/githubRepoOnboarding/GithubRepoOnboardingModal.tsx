import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type {
  GithubCliPrerequisites,
  GithubCliRepoSummary,
  GithubRepoVisibility,
} from '../../githubRepoOnboarding/types';
import { GitHubBrandIcon } from '../agentProviderIcons';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  buildGithubRepoCreatePayload,
  filterGithubRepos,
  githubPrerequisitesHeading,
  githubPrerequisitesUiState,
  githubRepoOnboardingProgressLabel,
  joinCloneDestinationPath,
  repoBasenameFromNameWithOwner,
  validateNewGithubRepoForm,
  type GithubRepoOnboardingModalStep,
  type NewGithubRepoFormValues,
} from './githubRepoOnboardingUi';

type SourceMode = 'existing' | 'new';

type ProgressPhase = 'create' | 'clone' | 'attach';

export function GithubRepoOnboardingModal({
  open,
  onOpenChange,
  onAttachClone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Attach an existing local clone at `rootPath` (same path as the local folder picker). */
  onAttachClone: (rootPath: string) => Promise<{ error?: string }>;
}) {
  const [step, setStep] = useState<GithubRepoOnboardingModalStep>('prerequisites');
  const [prerequisites, setPrerequisites] = useState<GithubCliPrerequisites | null>(null);
  const [prereqError, setPrereqError] = useState<string | null>(null);
  const [sourceMode, setSourceMode] = useState<SourceMode>('existing');
  const [repos, setRepos] = useState<GithubCliRepoSummary[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);
  const [repoSearch, setRepoSearch] = useState('');
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [newRepoForm, setNewRepoForm] = useState<NewGithubRepoFormValues>({
    owner: '',
    name: '',
    visibility: 'private',
    description: '',
    confirmNonPrivate: false,
  });
  const [newRepoFormError, setNewRepoFormError] = useState<string | null>(null);
  const [cloneParentPath, setCloneParentPath] = useState('');
  const [cloneDestination, setCloneDestination] = useState('');
  const [destinationError, setDestinationError] = useState<string | null>(null);
  const [destinationChecking, setDestinationChecking] = useState(false);
  const [progressPhase, setProgressPhase] = useState<ProgressPhase>('clone');
  const [createdRepoSlug, setCreatedRepoSlug] = useState<string | null>(null);
  const [workingError, setWorkingError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const resetFlow = useCallback(() => {
    setStep('prerequisites');
    setPrerequisites(null);
    setPrereqError(null);
    setSourceMode('existing');
    setRepos([]);
    setReposLoading(false);
    setReposError(null);
    setRepoSearch('');
    setSelectedRepo(null);
    setNewRepoForm({
      owner: '',
      name: '',
      visibility: 'private',
      description: '',
      confirmNonPrivate: false,
    });
    setNewRepoFormError(null);
    setCloneParentPath('');
    setCloneDestination('');
    setDestinationError(null);
    setDestinationChecking(false);
    setProgressPhase('clone');
    setCreatedRepoSlug(null);
    setWorkingError(null);
    setSuccessMessage(null);
  }, []);

  useEffect(() => {
    if (!open) {
      resetFlow();
    }
  }, [open, resetFlow]);

  const loadPrerequisites = useCallback(async () => {
    setStep('prerequisites');
    setPrereqError(null);
    setPrerequisites(null);
    try {
      const result = await window.electronAPI.githubRepoOnboarding.checkPrerequisites();
      if (!result.ok) {
        setPrereqError(result.message);
        setStep('error');
        return;
      }
      setPrerequisites(result.prerequisites);
      if (githubPrerequisitesUiState(result.prerequisites) === 'blocked') {
        setStep('prerequisites');
        return;
      }
      setStep('source');
    } catch (err) {
      setPrereqError(err instanceof Error ? err.message : String(err));
      setStep('error');
    }
  }, []);

  useEffect(() => {
    if (open) {
      void loadPrerequisites();
    }
  }, [open, loadPrerequisites]);

  const loadRepos = useCallback(async () => {
    setReposLoading(true);
    setReposError(null);
    try {
      const result = await window.electronAPI.githubRepoOnboarding.listRepos({ limit: 100 });
      if (!result.ok) {
        setReposError(result.message);
        return;
      }
      setRepos(result.repos);
    } catch (err) {
      setReposError(err instanceof Error ? err.message : String(err));
    } finally {
      setReposLoading(false);
    }
  }, []);

  useEffect(() => {
    if (step === 'existing' && repos.length === 0 && !reposLoading && !reposError) {
      void loadRepos();
    }
  }, [step, repos.length, reposLoading, reposError, loadRepos]);

  const activeRepoSlug = (): string => {
    if (sourceMode === 'existing') {
      return selectedRepo ?? '';
    }
    if (createdRepoSlug) return createdRepoSlug;
    const owner = newRepoForm.owner.trim();
    const name = newRepoForm.name.trim();
    return owner ? `${owner}/${name}` : name;
  };

  const activeRepoBasename = (): string => repoBasenameFromNameWithOwner(activeRepoSlug());

  const checkDestination = useCallback(async (destination: string) => {
    setDestinationChecking(true);
    setDestinationError(null);
    try {
      const result = await window.electronAPI.githubRepoOnboarding.checkCloneDestination({
        destination,
      });
      if (!result.ok) {
        setDestinationError(result.message);
        return false;
      }
      return true;
    } catch (err) {
      setDestinationError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setDestinationChecking(false);
    }
  }, []);

  const runCloneAndAttach = useCallback(
    async (repoSlug: string, destination: string, mode: SourceMode) => {
      setStep('progress');
      setProgressPhase('clone');
      setWorkingError(null);
      try {
        const cloneResult = await window.electronAPI.githubRepoOnboarding.cloneRepo({
          repo: repoSlug,
          destination,
        });
        if (!cloneResult.ok) {
          setWorkingError(cloneResult.message);
          setStep('error');
          return;
        }
        setProgressPhase('attach');
        const attach = await onAttachClone(cloneResult.destination);
        if (attach.error) {
          setWorkingError(attach.error);
          setStep('error');
          return;
        }
        setSuccessMessage(
          mode === 'new'
            ? `Created ${repoSlug}, cloned locally, and attached to this project.`
            : `Cloned ${repoSlug} and attached to this project.`,
        );
        setStep('success');
      } catch (err) {
        setWorkingError(err instanceof Error ? err.message : String(err));
        setStep('error');
      }
    },
    [onAttachClone],
  );

  const runWorkflow = useCallback(async () => {
    const destination = cloneDestination.trim();
    if (!destination) {
      setDestinationError('Clone destination is required.');
      return;
    }
    const destOk = await checkDestination(destination);
    if (!destOk) return;

    if (sourceMode === 'existing') {
      const repoSlug = selectedRepo;
      if (!repoSlug) {
        setDestinationError('Select a GitHub repository.');
        return;
      }
      await runCloneAndAttach(repoSlug, destination, 'existing');
      return;
    }

    const formError = validateNewGithubRepoForm(newRepoForm);
    if (formError) {
      setDestinationError(formError);
      return;
    }

    setStep('progress');
    setWorkingError(null);

    let repoSlug = createdRepoSlug;
    if (!repoSlug) {
      setProgressPhase('create');
      try {
        const createResult = await window.electronAPI.githubRepoOnboarding.createRepo(
          buildGithubRepoCreatePayload(newRepoForm),
        );
        if (!createResult.ok) {
          setWorkingError(createResult.message);
          setStep('error');
          return;
        }
        repoSlug = createResult.nameWithOwner;
        setCreatedRepoSlug(repoSlug);
      } catch (err) {
        setWorkingError(err instanceof Error ? err.message : String(err));
        setStep('error');
        return;
      }
    }

    await runCloneAndAttach(repoSlug, destination, 'new');
  }, [
    checkDestination,
    cloneDestination,
    createdRepoSlug,
    newRepoForm,
    runCloneAndAttach,
    selectedRepo,
    sourceMode,
  ]);

  const handlePickCloneParent = async () => {
    setDestinationError(null);
    const picked = await window.electronAPI.project.pickRepoDirectory({
      forProjectCreate: true,
    });
    if (!picked) return;
    if ('error' in picked) {
      setDestinationError(
        picked.error === 'NOT_WRITABLE'
          ? 'That folder is not writable.'
          : 'Could not use that folder.',
      );
      return;
    }
    const parent = picked.rootPath;
    setCloneParentPath(parent);
    const proposed = joinCloneDestinationPath(parent, activeRepoBasename());
    setCloneDestination(proposed);
    void checkDestination(proposed);
  };

  const handleContinueFromSource = () => {
    if (sourceMode === 'existing') {
      setStep('existing');
      return;
    }
    setStep('new');
  };

  const handleContinueToDestination = () => {
    if (sourceMode === 'existing') {
      if (!selectedRepo) {
        setReposError('Select a repository from the list.');
        return;
      }
      setReposError(null);
      setCloneDestination((prev) =>
        prev || (cloneParentPath ? joinCloneDestinationPath(cloneParentPath, activeRepoBasename()) : ''),
      );
      setStep('destination');
      return;
    }
    const formError = validateNewGithubRepoForm(newRepoForm);
    if (formError) {
      setNewRepoFormError(formError);
      return;
    }
    setNewRepoFormError(null);
    setCloneDestination((prev) =>
      prev || (cloneParentPath ? joinCloneDestinationPath(cloneParentPath, activeRepoBasename()) : ''),
    );
    setStep('destination');
  };

  const filteredRepos = filterGithubRepos(repos, repoSearch);

  const closeModal = () => onOpenChange(false);

  const retryFromError = () => {
    if (createdRepoSlug && workingError) {
      void runCloneAndAttach(createdRepoSlug, cloneDestination.trim(), 'new');
      return;
    }
    if (step === 'error' && prereqError) {
      void loadPrerequisites();
      return;
    }
    if (step === 'error' && destinationError) {
      setStep('destination');
      return;
    }
    void runWorkflow();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(640px,90vh)] max-w-[min(480px,92vw)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitHubBrandIcon className="size-4" />
            Add repository from GitHub
          </DialogTitle>
          <DialogDescription>
            Clone an existing repository or create a new one with the GitHub CLI, then attach it to
            this project.
          </DialogDescription>
        </DialogHeader>

        {step === 'prerequisites' ? (
          <div className="space-y-3 py-2">
            {!prerequisites ? (
              <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Checking GitHub CLI…
              </p>
            ) : (
              <>
                <p className="text-[14px] font-medium text-foreground">
                  {githubPrerequisitesHeading(prerequisites)}
                </p>
                {prerequisites.installed && prerequisites.version ? (
                  <p className="text-[12px] text-muted-foreground">{prerequisites.version}</p>
                ) : null}
                {prerequisites.message ? (
                  <p className="rounded-md border border-border bg-muted/50 px-3 py-2 text-[12px] leading-snug text-muted-foreground">
                    {prerequisites.message}
                  </p>
                ) : null}
                {!prerequisites.installed ? (
                  <p className="text-[12px] text-muted-foreground">
                    Install from{' '}
                    <a
                      href="https://cli.github.com/"
                      className="text-foreground underline"
                      target="_blank"
                      rel="noreferrer"
                    >
                      cli.github.com
                    </a>
                    , then click Retry.
                  </p>
                ) : !prerequisites.authenticated ? (
                  <p className="text-[12px] text-muted-foreground">
                    Run <code className="text-foreground">gh auth login</code> in your terminal,
                    then click Retry.
                  </p>
                ) : null}
              </>
            )}
          </div>
        ) : null}

        {step === 'source' ? (
          <div className="grid gap-2 py-2">
            <button
              type="button"
              onClick={() => {
                setSourceMode('existing');
                handleContinueFromSource();
              }}
              className="rounded-lg border border-border bg-card px-3 py-3 text-left transition hover:bg-accent"
            >
              <p className="text-[13px] font-medium text-foreground">Existing repository</p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                Pick from repos visible to your GitHub account.
              </p>
            </button>
            <button
              type="button"
              onClick={() => {
                setSourceMode('new');
                handleContinueFromSource();
              }}
              className="rounded-lg border border-border bg-card px-3 py-3 text-left transition hover:bg-accent"
            >
              <p className="text-[13px] font-medium text-foreground">New repository</p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                Create on GitHub (private by default), then clone locally.
              </p>
            </button>
          </div>
        ) : null}

        {step === 'existing' ? (
          <div className="space-y-3 py-2">
            <Input
              value={repoSearch}
              onChange={(e) => setRepoSearch(e.target.value)}
              placeholder="Search repositories…"
              className="text-[13px]"
            />
            {reposLoading ? (
              <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Loading repositories…
              </p>
            ) : reposError ? (
              <p className="text-[12px] text-destructive">{reposError}</p>
            ) : (
              <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border p-1">
                {filteredRepos.length === 0 ? (
                  <li className="px-2 py-3 text-[12px] text-muted-foreground">No repositories found.</li>
                ) : (
                  filteredRepos.map((repo) => {
                    const selected = selectedRepo === repo.nameWithOwner;
                    return (
                      <li key={repo.nameWithOwner}>
                        <button
                          type="button"
                          onClick={() => setSelectedRepo(repo.nameWithOwner)}
                          className={`w-full rounded-md px-2 py-2 text-left text-[12px] transition ${
                            selected ? 'bg-accent text-foreground' : 'hover:bg-muted/80'
                          }`}
                        >
                          <span className="font-medium">{repo.nameWithOwner}</span>
                          {repo.description ? (
                            <span className="mt-0.5 block truncate text-muted-foreground">
                              {repo.description}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            )}
          </div>
        ) : null}

        {step === 'new' ? (
          <div className="space-y-3 py-2">
            <div className="grid gap-1.5">
              <label className="text-[12px] font-medium text-foreground" htmlFor="gh-repo-owner">
                Owner <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Input
                id="gh-repo-owner"
                value={newRepoForm.owner}
                onChange={(e) => setNewRepoForm((f) => ({ ...f, owner: e.target.value }))}
                placeholder="your-username or org"
                className="text-[13px]"
              />
            </div>
            <div className="grid gap-1.5">
              <label className="text-[12px] font-medium text-foreground" htmlFor="gh-repo-name">
                Repository name
              </label>
              <Input
                id="gh-repo-name"
                value={newRepoForm.name}
                onChange={(e) => setNewRepoForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="my-service"
                className="text-[13px]"
              />
            </div>
            <div className="grid gap-1.5">
              <label className="text-[12px] font-medium text-foreground" htmlFor="gh-repo-visibility">
                Visibility
              </label>
              <select
                id="gh-repo-visibility"
                value={newRepoForm.visibility}
                onChange={(e) => {
                  const visibility = e.target.value as GithubRepoVisibility;
                  setNewRepoForm((f) => ({
                    ...f,
                    visibility,
                    confirmNonPrivate: visibility === 'private' ? false : f.confirmNonPrivate,
                  }));
                }}
                className="h-9 rounded-md border border-input bg-background px-3 text-[13px]"
              >
                <option value="private">Private</option>
                <option value="public">Public</option>
                <option value="internal">Internal</option>
              </select>
            </div>
            {newRepoForm.visibility !== 'private' ? (
              <label className="flex items-start gap-2 text-[12px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={newRepoForm.confirmNonPrivate}
                  onChange={(e) =>
                    setNewRepoForm((f) => ({ ...f, confirmNonPrivate: e.target.checked }))
                  }
                  className="mt-0.5"
                />
                <span>
                  I understand this repository will be <strong className="text-foreground">{newRepoForm.visibility}</strong>{' '}
                  on GitHub.
                </span>
              </label>
            ) : null}
            <div className="grid gap-1.5">
              <label className="text-[12px] font-medium text-foreground" htmlFor="gh-repo-desc">
                Description <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Textarea
                id="gh-repo-desc"
                value={newRepoForm.description}
                onChange={(e) => setNewRepoForm((f) => ({ ...f, description: e.target.value }))}
                rows={2}
                className="text-[13px]"
              />
            </div>
            {newRepoFormError ? (
              <p className="text-[12px] text-destructive">{newRepoFormError}</p>
            ) : null}
          </div>
        ) : null}

        {step === 'destination' ? (
          <div className="space-y-3 py-2">
            <p className="text-[12px] text-muted-foreground">
              Repository: <span className="font-mono text-foreground">{activeRepoSlug()}</span>
            </p>
            <Button type="button" variant="outline" size="sm" onClick={() => void handlePickCloneParent()}>
              Choose parent folder…
            </Button>
            {cloneParentPath ? (
              <p className="truncate font-mono text-[11px] text-muted-foreground" title={cloneParentPath}>
                Parent: {cloneParentPath}
              </p>
            ) : null}
            <div className="grid gap-1.5">
              <label className="text-[12px] font-medium text-foreground" htmlFor="gh-clone-dest">
                Clone destination
              </label>
              <Input
                id="gh-clone-dest"
                value={cloneDestination}
                onChange={(e) => {
                  setCloneDestination(e.target.value);
                  setDestinationError(null);
                }}
                onBlur={() => {
                  if (cloneDestination.trim()) void checkDestination(cloneDestination.trim());
                }}
                placeholder="/Users/you/dev/my-repo"
                className="font-mono text-[12px]"
              />
            </div>
            {destinationChecking ? (
              <p className="text-[12px] text-muted-foreground">Checking destination…</p>
            ) : null}
            {destinationError ? (
              <p className="text-[12px] text-destructive">{destinationError}</p>
            ) : null}
            <p className="text-[11px] leading-snug text-muted-foreground">
              Fluxx will refuse to clone into a folder that already exists. To attach an existing
              clone, use Add repo → From local folder.
            </p>
          </div>
        ) : null}

        {step === 'progress' ? (
          <div className="flex items-center gap-2 py-6 text-[13px] text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {githubRepoOnboardingProgressLabel({ mode: sourceMode, phase: progressPhase })}
          </div>
        ) : null}

        {step === 'success' ? (
          <p className="py-2 text-[13px] text-status-success">{successMessage}</p>
        ) : null}

        {step === 'error' ? (
          <div className="space-y-2 py-2">
            <p className="text-[13px] text-destructive">
              {workingError ?? prereqError ?? destinationError ?? 'Something went wrong.'}
            </p>
            {createdRepoSlug ? (
              <p className="text-[12px] text-muted-foreground">
                GitHub repository <span className="font-mono">{createdRepoSlug}</span> was created.
                You can retry cloning to your chosen destination.
              </p>
            ) : null}
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:gap-0">
          {step === 'prerequisites' ? (
            <>
              <Button type="button" variant="ghost" onClick={closeModal}>
                Cancel
              </Button>
              {prerequisites && githubPrerequisitesUiState(prerequisites) === 'blocked' ? (
                <Button type="button" onClick={() => void loadPrerequisites()}>
                  Retry
                </Button>
              ) : null}
            </>
          ) : null}

          {step === 'source' ? (
            <Button type="button" variant="ghost" onClick={closeModal}>
              Cancel
            </Button>
          ) : null}

          {step === 'existing' ? (
            <>
              <Button type="button" variant="ghost" onClick={() => setStep('source')}>
                Back
              </Button>
              <Button type="button" onClick={handleContinueToDestination} disabled={!selectedRepo}>
                Continue
              </Button>
            </>
          ) : null}

          {step === 'new' ? (
            <>
              <Button type="button" variant="ghost" onClick={() => setStep('source')}>
                Back
              </Button>
              <Button type="button" onClick={handleContinueToDestination}>
                Continue
              </Button>
            </>
          ) : null}

          {step === 'destination' ? (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStep(sourceMode === 'existing' ? 'existing' : 'new')}
              >
                Back
              </Button>
              <Button
                type="button"
                onClick={() => void runWorkflow()}
                disabled={!cloneDestination.trim() || destinationChecking}
              >
                Clone and attach
              </Button>
            </>
          ) : null}

          {step === 'success' ? (
            <Button type="button" onClick={closeModal}>
              Done
            </Button>
          ) : null}

          {step === 'error' ? (
            <>
              <Button type="button" variant="ghost" onClick={closeModal}>
                Close
              </Button>
              <Button type="button" onClick={() => void retryFromError()}>
                Retry
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
