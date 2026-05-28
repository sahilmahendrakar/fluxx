import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import { ListFilter, Search, UserCircle2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { Agent, RepoConfig, TaskStatus } from '../types';
import { AGENTS, COLUMNS } from '../types';
import {
  type BoardFilterState,
  boardFiltersAreActive,
  DEFAULT_BOARD_FILTER,
  UNASSIGNED_ASSIGNEE_VALUE,
  UNASSIGNED_TASK_AGENT_VALUE,
  UNLABELED_VALUE,
} from '../boardFilter';
import {
  type ProjectMember,
  projectMemberDisplayLabel,
} from '../renderer/projects/members';
import {
  boardFilterPickerLabelMatches,
  filterByBoardFilterPickerQuery,
} from './boardFilterOptionSearch';
import { ProjectMemberAvatar } from './ProjectMemberAvatar';
import { repoDisplayLabel } from '../repoIdentity';

/** Visible row labels for special filter rows; substring filter applies when query is non-empty. */
const FILTER_PICKER_UNLABELED_LABEL = 'Unlabeled';
const FILTER_PICKER_UNASSIGNED_LABEL = 'Unassigned';

const AGENT_FILTER_ROWS: { id: Agent | typeof UNASSIGNED_TASK_AGENT_VALUE; label: string }[] = [
  ...AGENTS,
  { id: UNASSIGNED_TASK_AGENT_VALUE, label: 'None' },
];

function agentFilterLabel(id: Exclude<BoardFilterState['agent'], 'all'>): string {
  if (id === UNASSIGNED_TASK_AGENT_VALUE) return 'None';
  return AGENTS.find((a) => a.id === id)?.label ?? id;
}

const statusLabel = (id: TaskStatus) => COLUMNS.find((c) => c.id === id)?.label ?? id;

function FilterToken({
  onRemove,
  k,
  v,
  title,
  leading,
}: {
  onRemove: () => void;
  k: string;
  v: string;
  title?: string;
  leading?: ReactNode;
}) {
  return (
    <Badge
      title={title}
      variant="secondary"
      className={cn(
        'max-w-[min(100%,14rem)] shrink-0 gap-0.5 rounded-md border-status-review/25 bg-status-review/10 py-0 pl-2 pr-0.5 text-[11px] font-normal leading-tight text-status-review-foreground',
        leading && 'gap-1',
      )}
    >
      {leading ? <span className="shrink-0">{leading}</span> : null}
      <span className="min-w-0 truncate">
        <span className="text-status-review">{k}</span>
        <span className="text-muted-foreground"> = </span>
        <span>{v}</span>
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-5 shrink-0 text-muted-foreground hover:text-foreground"
        onClick={onRemove}
        aria-label={`Remove ${k} filter`}
      >
        <X className="size-3" strokeWidth={2.5} />
      </Button>
    </Badge>
  );
}

function BoardFilterPickerSubPanelHeader({
  onBack,
  searchInputId,
  listboxId,
  searchQuery,
  onSearchQueryChange,
  searchInputRef,
  searchPlaceholder,
}: {
  onBack: () => void;
  searchInputId: string;
  listboxId: string;
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  searchInputRef: Ref<HTMLInputElement>;
  searchPlaceholder: string;
}) {
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        className="h-auto w-full justify-start gap-1.5 rounded-none border-b border-border px-2.5 py-1.5 text-left text-[11px] text-muted-foreground"
        onClick={onBack}
      >
        ‹ Back
      </Button>
      <div className="border-b border-border px-2.5 pb-2 pt-1.5">
        <div className="relative">
          <Input
            ref={searchInputRef}
            id={searchInputId}
            type="text"
            role="searchbox"
            inputMode="search"
            enterKeyHint="search"
            aria-controls={listboxId}
            aria-label={searchPlaceholder}
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder={searchPlaceholder}
            autoComplete="off"
            spellCheck={false}
            className={cn('h-7 py-1 pl-2 text-[12px]', searchQuery ? 'pr-8' : 'pr-2')}
          />
          {searchQuery ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-0 top-1/2 size-7 -translate-y-1/2 text-muted-foreground"
              onClick={() => onSearchQueryChange('')}
              aria-label="Clear filter search"
            >
              <X className="size-3.5" strokeWidth={2.5} />
            </Button>
          ) : null}
        </div>
      </div>
    </>
  );
}

const filterPickerOptionClass =
  'h-auto w-full justify-start rounded-none px-2.5 py-1.5 text-left text-[12px] font-normal';

type AddPanel = 'main' | 'agent' | 'label' | 'status' | 'assignee' | 'repo';

type Props = {
  filter: BoardFilterState;
  onFilterChange: (next: BoardFilterState) => void;
  labelOptions: string[];
  doneHiddenCount: number;
  projectMembers?: ProjectMember[];
  /** Multi-repo board: show repo filter UI (caller gates on flag + repo count). */
  showRepoFilter?: boolean;
  projectRepos?: RepoConfig[];
};

export function BoardFilterBar({
  filter,
  onFilterChange,
  labelOptions,
  doneHiddenCount,
  projectMembers,
  showRepoFilter = false,
  projectRepos,
}: Props) {
  const inputId = useId();
  const pickerSearchFieldId = useId();
  const pickerOptionsListboxId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const [panel, setPanel] = useState<AddPanel>('main');
  const [pickerSearchQuery, setPickerSearchQuery] = useState('');
  const pickerSearchInputRef = useRef<HTMLInputElement>(null);

  const hasActive = boardFiltersAreActive(filter);
  const assigneeOptions = projectMembers ?? [];
  const showAssigneeFilter = assigneeOptions.length > 0;
  const assigneeLabel = (value: Exclude<BoardFilterState['assignee'], null>) => {
    if (value === UNASSIGNED_ASSIGNEE_VALUE) {
      return FILTER_PICKER_UNASSIGNED_LABEL;
    }
    const member = assigneeOptions.find((m) => m.uid === value);
    return member ? projectMemberDisplayLabel(member) : value;
  };
  const assigneeFilterMember =
    filter.assignee != null && filter.assignee !== UNASSIGNED_ASSIGNEE_VALUE
      ? assigneeOptions.find((m) => m.uid === filter.assignee)
      : undefined;
  const set = (patch: Partial<BoardFilterState>) => {
    onFilterChange({ ...filter, ...patch });
  };

  const goPickerMain = () => {
    setPanel('main');
    setPickerSearchQuery('');
  };

  const repoFilterTokenLabel = useMemo(() => {
    if (filter.repoId == null) return '';
    const r = projectRepos?.find((x) => x.id === filter.repoId);
    return r ? repoDisplayLabel(r) : filter.repoId;
  }, [filter.repoId, projectRepos]);

  const handleMenuOpenChange = (open: boolean) => {
    setMenuOpen(open);
    if (!open) {
      setPanel('main');
      setPickerSearchQuery('');
    }
  };

  useLayoutEffect(() => {
    if (!menuOpen || panel === 'main') return;
    pickerSearchInputRef.current?.focus({ preventScroll: true });
  }, [menuOpen, panel]);

  // Picker: Unlabeled / Unassigned — always when query empty; with text, only if it matches that fixed label (case-insensitive), pinned above filtered rows.
  const filteredAgents = filterByBoardFilterPickerQuery(pickerSearchQuery, AGENT_FILTER_ROWS, (a) => a.label);
  const filteredColumns = filterByBoardFilterPickerQuery(pickerSearchQuery, COLUMNS, (c) => c.label);
  const showUnlabeledRow =
    pickerSearchQuery.trim() === '' ||
    boardFilterPickerLabelMatches(pickerSearchQuery, FILTER_PICKER_UNLABELED_LABEL);
  const filteredLabels = filterByBoardFilterPickerQuery(pickerSearchQuery, labelOptions, (l) => l);
  const showUnassignedRow =
    pickerSearchQuery.trim() === '' ||
    boardFilterPickerLabelMatches(pickerSearchQuery, FILTER_PICKER_UNASSIGNED_LABEL);
  const filteredAssignees = filterByBoardFilterPickerQuery(
    pickerSearchQuery,
    assigneeOptions,
    (m) => projectMemberDisplayLabel(m),
  );
  const filteredRepos = filterByBoardFilterPickerQuery(
    pickerSearchQuery,
    projectRepos ?? [],
    (r) => repoDisplayLabel(r),
  );

  const agentPanelEmpty = filteredAgents.length === 0;
  const statusPanelEmpty = filteredColumns.length === 0;
  const labelPanelEmpty = !showUnlabeledRow && filteredLabels.length === 0;
  const assigneePanelEmpty = !showUnassignedRow && filteredAssignees.length === 0;
  const repoPanelEmpty = filteredRepos.length === 0;

  return (
    <div className="relative min-w-0 flex-1">
      <div
        className="flex min-h-9 w-full min-w-0 items-center gap-1.5 rounded-lg border border-input bg-background py-1 pl-2 pr-1 shadow-sm"
        role="search"
      >
        <div className="flex min-h-6 min-w-0 flex-1 items-center gap-1.5">
          <Search
            className="size-3.5 shrink-0 text-muted-foreground"
            strokeWidth={2}
            aria-hidden
          />
          <div className="relative min-w-0 flex-1">
            <Input
              id={inputId}
              type="text"
              inputMode="search"
              enterKeyHint="search"
              value={filter.search}
              onChange={(e) => set({ search: e.target.value })}
              placeholder="Filter by keyword…"
              autoComplete="off"
              spellCheck={false}
              className={cn(
                'h-auto min-w-0 border-0 bg-transparent py-0.5 text-[13px] shadow-none focus-visible:ring-0',
                filter.search ? 'pr-7' : '',
              )}
            />
            {filter.search ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-1/2 size-7 -translate-y-1/2 text-muted-foreground"
                onClick={() => set({ search: '' })}
                aria-label="Clear keyword search"
              >
                <X className="size-3.5" strokeWidth={2.5} />
              </Button>
            ) : null}
          </div>
        </div>
        <div
          className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1.5 pl-0.5"
        >
        {filter.agent !== 'all' ? (
          <FilterToken
            k="agent"
            v={agentFilterLabel(filter.agent)}
            onRemove={() => set({ agent: 'all' })}
          />
        ) : null}
        {filter.status !== 'all' ? (
          <FilterToken
            k="status"
            v={statusLabel(filter.status)}
            onRemove={() => set({ status: 'all' })}
          />
        ) : null}
        {filter.label != null ? (
          <FilterToken
            k="label"
            v={
              filter.label === UNLABELED_VALUE
                ? FILTER_PICKER_UNLABELED_LABEL
                : filter.label
            }
            onRemove={() => set({ label: null })}
          />
        ) : null}
        {filter.assignee != null ? (
          <FilterToken
            k="assignee"
            v={assigneeLabel(filter.assignee)}
            onRemove={() => set({ assignee: null })}
            leading={
              assigneeFilterMember ? (
                <ProjectMemberAvatar member={assigneeFilterMember} size="xs" />
              ) : undefined
            }
          />
        ) : null}
        {filter.repoId != null ? (
          <FilterToken
            k="repo"
            v={repoFilterTokenLabel}
            onRemove={() => set({ repoId: null })}
          />
        ) : null}
        {filter.hideDone ? (
          <FilterToken
            k="done"
            v="hidden"
            title={
              doneHiddenCount > 0
                ? `${doneHiddenCount} done task(s) not shown`
                : 'Hiding done tasks'
            }
            onRemove={() => set({ hideDone: false })}
          />
        ) : null}
        {!filter.includeDescription ? (
          <FilterToken
            k="searchIn"
            v="title"
            onRemove={() => set({ includeDescription: true })}
          />
        ) : null}
          {hasActive ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-1.5 text-[11px] text-muted-foreground"
              onClick={() => onFilterChange({ ...DEFAULT_BOARD_FILTER })}
            >
              Clear
            </Button>
          ) : null}
          <Popover open={menuOpen} onOpenChange={handleMenuOpenChange}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 text-muted-foreground"
                title="Add filter"
                aria-expanded={menuOpen}
                aria-haspopup="true"
              >
                <ListFilter className="size-3.5" strokeWidth={2} />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="flex w-56 max-h-72 flex-col overflow-hidden p-0"
              role="presentation"
            >
                {panel === 'main' ? (
                  <>
                    <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Add filter
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      className={cn(filterPickerOptionClass, 'justify-between')}
                      onClick={() => setPanel('agent')}
                    >
                      Agent
                      <span className="text-muted-foreground">›</span>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className={cn(filterPickerOptionClass, 'justify-between')}
                      onClick={() => setPanel('label')}
                    >
                      Label
                      <span className="text-muted-foreground">›</span>
                    </Button>
                    {showAssigneeFilter ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className={cn(filterPickerOptionClass, 'justify-between')}
                        onClick={() => setPanel('assignee')}
                      >
                        Assignee
                        <span className="text-muted-foreground">›</span>
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      className={cn(filterPickerOptionClass, 'justify-between')}
                      onClick={() => setPanel('status')}
                    >
                      Status
                      <span className="text-muted-foreground">›</span>
                    </Button>
                    {showRepoFilter ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className={cn(filterPickerOptionClass, 'justify-between')}
                        onClick={() => setPanel('repo')}
                      >
                        Repository
                        <span className="text-muted-foreground">›</span>
                      </Button>
                    ) : null}
                    {filter.includeDescription ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className={filterPickerOptionClass}
                        onClick={() => {
                          set({ includeDescription: false });
                          setMenuOpen(false);
                        }}
                      >
                        Title only (search)
                      </Button>
                    ) : null}
                    {!filter.hideDone ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className={filterPickerOptionClass}
                        onClick={() => {
                          set({ hideDone: true });
                          setMenuOpen(false);
                        }}
                      >
                        Hide done
                      </Button>
                    ) : null}
                  </>
                ) : null}
                {panel === 'agent' ? (
                  <>
                    <BoardFilterPickerSubPanelHeader
                      onBack={goPickerMain}
                      searchInputId={pickerSearchFieldId}
                      listboxId={pickerOptionsListboxId}
                      searchQuery={pickerSearchQuery}
                      onSearchQueryChange={setPickerSearchQuery}
                      searchInputRef={pickerSearchInputRef}
                      searchPlaceholder="Search agents…"
                    />
                    <div
                      id={pickerOptionsListboxId}
                      role="listbox"
                      aria-label="Agents"
                      className="max-h-40 min-h-0 flex-1 overflow-y-auto"
                    >
                      {agentPanelEmpty ? (
                        <div className="px-2.5 py-2 text-center text-[11px] text-muted-foreground">
                          No matches
                        </div>
                      ) : (
                        filteredAgents.map((a) => (
                          <Button
                            key={a.id}
                            type="button"
                            role="option"
                            variant="ghost"
                            className={filterPickerOptionClass}
                            onClick={() => {
                              set({ agent: a.id });
                              setMenuOpen(false);
                            }}
                          >
                            {a.label}
                          </Button>
                        ))
                      )}
                    </div>
                  </>
                ) : null}
                {panel === 'status' ? (
                  <>
                    <BoardFilterPickerSubPanelHeader
                      onBack={goPickerMain}
                      searchInputId={pickerSearchFieldId}
                      listboxId={pickerOptionsListboxId}
                      searchQuery={pickerSearchQuery}
                      onSearchQueryChange={setPickerSearchQuery}
                      searchInputRef={pickerSearchInputRef}
                      searchPlaceholder="Search statuses…"
                    />
                    <div
                      id={pickerOptionsListboxId}
                      role="listbox"
                      aria-label="Statuses"
                      className="max-h-40 min-h-0 flex-1 overflow-y-auto"
                    >
                      {statusPanelEmpty ? (
                        <div className="px-2.5 py-2 text-center text-[11px] text-muted-foreground">
                          No matches
                        </div>
                      ) : (
                        filteredColumns.map((col) => (
                          <Button
                            key={col.id}
                            type="button"
                            role="option"
                            variant="ghost"
                            className={filterPickerOptionClass}
                            onClick={() => {
                              set({ status: col.id });
                              setMenuOpen(false);
                            }}
                          >
                            {col.label}
                          </Button>
                        ))
                      )}
                    </div>
                  </>
                ) : null}
                {panel === 'label' ? (
                  <>
                    <BoardFilterPickerSubPanelHeader
                      onBack={goPickerMain}
                      searchInputId={pickerSearchFieldId}
                      listboxId={pickerOptionsListboxId}
                      searchQuery={pickerSearchQuery}
                      onSearchQueryChange={setPickerSearchQuery}
                      searchInputRef={pickerSearchInputRef}
                      searchPlaceholder="Search labels…"
                    />
                    <div
                      id={pickerOptionsListboxId}
                      role="listbox"
                      aria-label="Labels"
                      className="max-h-40 min-h-0 flex-1 overflow-y-auto"
                    >
                      {labelPanelEmpty ? (
                        <div className="px-2.5 py-2 text-center text-[11px] text-muted-foreground">
                          No matches
                        </div>
                      ) : (
                        <>
                          {showUnlabeledRow ? (
                            <Button
                              type="button"
                              role="option"
                              variant="ghost"
                              className={filterPickerOptionClass}
                              onClick={() => {
                                set({ label: UNLABELED_VALUE });
                                setMenuOpen(false);
                              }}
                            >
                              {FILTER_PICKER_UNLABELED_LABEL}
                            </Button>
                          ) : null}
                          {filteredLabels.map((lab) => (
                            <Button
                              key={lab}
                              type="button"
                              role="option"
                              variant="ghost"
                              className={filterPickerOptionClass}
                              onClick={() => {
                                set({ label: lab });
                                setMenuOpen(false);
                              }}
                            >
                              {lab}
                            </Button>
                          ))}
                        </>
                      )}
                    </div>
                  </>
                ) : null}
                {panel === 'assignee' ? (
                  <>
                    <BoardFilterPickerSubPanelHeader
                      onBack={goPickerMain}
                      searchInputId={pickerSearchFieldId}
                      listboxId={pickerOptionsListboxId}
                      searchQuery={pickerSearchQuery}
                      onSearchQueryChange={setPickerSearchQuery}
                      searchInputRef={pickerSearchInputRef}
                      searchPlaceholder="Search assignees…"
                    />
                    <div
                      id={pickerOptionsListboxId}
                      role="listbox"
                      aria-label="Assignees"
                      className="max-h-40 min-h-0 flex-1 overflow-y-auto"
                    >
                      {assigneePanelEmpty ? (
                        <div className="px-2.5 py-2 text-center text-[11px] text-muted-foreground">
                          No matches
                        </div>
                      ) : (
                        <>
                          {showUnassignedRow ? (
                            <Button
                              type="button"
                              role="option"
                              variant="ghost"
                              className={cn(filterPickerOptionClass, 'justify-start gap-2')}
                              onClick={() => {
                                set({ assignee: UNASSIGNED_ASSIGNEE_VALUE });
                                setMenuOpen(false);
                              }}
                            >
                              <UserCircle2
                                className="size-5 shrink-0 text-muted-foreground"
                                strokeWidth={1.5}
                                aria-hidden
                              />
                              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                                {FILTER_PICKER_UNASSIGNED_LABEL}
                              </span>
                            </Button>
                          ) : null}
                          {filteredAssignees.map((member) => (
                            <Button
                              key={member.uid}
                              type="button"
                              role="option"
                              variant="ghost"
                              className={cn(filterPickerOptionClass, 'justify-start gap-2')}
                              onClick={() => {
                                set({ assignee: member.uid });
                                setMenuOpen(false);
                              }}
                            >
                              <ProjectMemberAvatar member={member} size="xs" />
                              <span className="min-w-0 flex-1 truncate">
                                {projectMemberDisplayLabel(member)}
                              </span>
                            </Button>
                          ))}
                        </>
                      )}
                    </div>
                  </>
                ) : null}
                {panel === 'repo' ? (
                  <>
                    <BoardFilterPickerSubPanelHeader
                      onBack={goPickerMain}
                      searchInputId={pickerSearchFieldId}
                      listboxId={pickerOptionsListboxId}
                      searchQuery={pickerSearchQuery}
                      onSearchQueryChange={setPickerSearchQuery}
                      searchInputRef={pickerSearchInputRef}
                      searchPlaceholder="Search repositories..."
                    />
                    <div
                      id={pickerOptionsListboxId}
                      role="listbox"
                      aria-label="Repositories"
                      className="max-h-40 min-h-0 flex-1 overflow-y-auto"
                    >
                      {repoPanelEmpty ? (
                        <div className="px-2.5 py-2 text-center text-[11px] text-muted-foreground">
                          No matches
                        </div>
                      ) : (
                        filteredRepos.map((r) => (
                          <Button
                            key={r.id}
                            type="button"
                            role="option"
                            variant="ghost"
                            className={filterPickerOptionClass}
                            onClick={() => {
                              set({ repoId: r.id });
                              setMenuOpen(false);
                            }}
                          >
                            {repoDisplayLabel(r)}
                          </Button>
                        ))
                      )}
                    </div>
                  </>
                ) : null}
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </div>
  );
}
