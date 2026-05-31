import { ChevronDown, FolderOpen } from 'lucide-react';
import { GitHubBrandIcon } from '../agentProviderIcons';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  githubRepoAddOptionDisabledTitle,
  isGithubRepoAddOptionEnabled,
} from './githubRepoOnboardingUi';

export function AddRepoDropdown({
  busy = false,
  gitIntegrationEnabled,
  onFromLocalFolder,
  onFromGithub,
}: {
  busy?: boolean;
  gitIntegrationEnabled: boolean;
  onFromLocalFolder: () => void;
  onFromGithub: () => void;
}) {
  const githubEnabled = isGithubRepoAddOptionEnabled(gitIntegrationEnabled);
  const githubDisabledTitle = githubRepoAddOptionDisabledTitle(gitIntegrationEnabled);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          className="h-auto gap-1 rounded-md border-border bg-muted px-2.5 py-1.5 text-[12px] font-medium text-foreground hover:bg-accent"
        >
          {busy ? 'Adding…' : 'Add repo'}
          <ChevronDown className="size-3.5 opacity-60" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[11rem]">
        <DropdownMenuItem
          disabled={busy}
          onSelect={() => onFromLocalFolder()}
          className="gap-2 text-[12px]"
        >
          <FolderOpen className="size-3.5 shrink-0 opacity-70" aria-hidden />
          From local folder
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={busy || !githubEnabled}
          title={githubDisabledTitle}
          onSelect={() => {
            if (githubEnabled) onFromGithub();
          }}
          className="gap-2 text-[12px]"
        >
          <GitHubBrandIcon className="size-3.5 shrink-0 opacity-90" />
          From GitHub
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
