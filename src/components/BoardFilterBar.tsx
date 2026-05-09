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
import type { Agent, RepoConfig, TaskStatus } from '../types';
import { AGENTS, COLUMNS } from '../types';
import {
  type BoardFilterState,
  boardFiltersAreActive,
  DEFAULT_BOARD_FILTER,
  UNASSIGNED_ASSIGNEE_VALUE,
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

const agentLabel = (id: Agent) => AGENTS.find((a) => a.id === id)?.label ?? id;

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
    <span
      title={title}
      className={`inline-flex max-w-[min(100%,14rem)] shrink-0 items-center rounded border border-sky-500/20 bg-sky-950/35 pl-2 pr-0.5 text-[11px] leading-tight text-sky-100/90 ${
        leading ? 'gap-1' : 'gap-0.5'
      }`}
    >
      {leading ? <span className="shrink-0">{leading}</span> : null}
      <span className="min-w-0 truncate">
        <span className="text-sky-400/80">{k}</span>
        <span className="text-zinc-500"> = </span>
        <span className="text-zinc-200">{v}</span>
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-500 transition hover:bg-white/10 hover:text-zinc-200"
        aria-label={`Remove ${k} filter`}
      >
        <X className="h-3 w-3" strokeWidth={2.5} />
      </button>
    </span>
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
      <button
        type="button"
        onClick={onBack}
        className="flex w-full items-center gap-1.5 border-b border-zinc-800/80 px-2.5 py-1.5 text-left text-[11px] text-zinc-500 hover:bg-zinc-800/50"
      >
        ‹ Back
      </button>
      <div className="border-b border-zinc-800/80 px-2.5 pb-2 pt-1.5">
        <div className="relative">
          <input
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
            className={`w-full rounded border border-zinc-800 bg-zinc-900/40 py-1 pl-2 text-[12px] text-zinc-200 placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600/50 ${searchQuery ? 'pr-8' : 'pr-2'}`}
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => onSearchQueryChange('')}
              className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-zinc-500 transition hover:bg-white/10 hover:text-zinc-200"
              aria-label="Clear filter search"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}

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
  const wrapRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (!menuOpen) return;
    setPanel('main');
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) {
      setPickerSearchQuery('');
    }
  }, [menuOpen]);

  useLayoutEffect(() => {
    if (!menuOpen || panel === 'main') return;
    pickerSearchInputRef.current?.focus({ preventScroll: true });
  }, [menuOpen, panel]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      const el = wrapRef.current;
      if (!el?.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc, true);
    return () => document.removeEventListener('mousedown', onDoc, true);
  }, [menuOpen]);

  // Picker: Unlabeled / Unassigned — always when query empty; with text, only if it matches that fixed label (case-insensitive), pinned above filtered rows.
  const filteredAgents = filterByBoardFilterPickerQuery(pickerSearchQuery, AGENTS, (a) => a.label);
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
    <div ref={wrapRef} className="relative min-w-0 flex-1">
      <div
        className="flex min-h-[2.25rem] w-full min-w-0 items-center gap-1.5 rounded-md border border-zinc-800/90 bg-zinc-950/60 py-1 pl-2 pr-1 shadow-sm shadow-black/20"
        role="search"
      >
        <div className="flex min-h-[1.5rem] min-w-0 flex-1 items-center gap-1.5">
          <Search
            className="h-3.5 w-3.5 shrink-0 text-zinc-500"
            strokeWidth={2}
            aria-hidden
          />
          <div className="relative min-w-0 flex-1">
            <input
              id={inputId}
              type="text"
              inputMode="search"
              enterKeyHint="search"
              value={filter.search}
              onChange={(e) => set({ search: e.target.value })}
              placeholder="Filter by keyword…"
              autoComplete="off"
              spellCheck={false}
              className={`min-w-0 w-full border-0 bg-transparent py-0.5 text-[13px] text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-0 ${filter.search ? 'pr-7' : ''}`}
            />
            {filter.search ? (
              <button
                type="button"
                onClick={() => set({ search: '' })}
                className="absolute right-0 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-zinc-500 transition hover:bg-white/10 hover:text-zinc-200"
                aria-label="Clear keyword search"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2.5} />
              </button>
            ) : null}
          </div>
        </div>
        <div
          className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1.5 pl-0.5"
        >
        {filter.agent !== 'all' ? (
          <FilterToken
            k="agent"
            v={agentLabel(filter.agent)}
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
            <button
              type="button"
              onClick={() => onFilterChange({ ...DEFAULT_BOARD_FILTER })}
              className="rounded px-1.5 py-1 text-[11px] font-medium text-zinc-500 transition hover:text-zinc-300"
            >
              Clear
            </button>
          ) : null}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              className="flex h-7 w-7 items-center justify-center rounded text-zinc-500 transition hover:bg-zinc-800/80 hover:text-zinc-300"
              title="Add filter"
              aria-expanded={menuOpen}
              aria-haspopup="true"
            >
              <ListFilter className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
            {menuOpen ? (
              <div
                className="absolute right-0 top-full z-50 mt-1 flex w-56 max-h-72 flex-col origin-top-right overflow-hidden rounded-md border border-zinc-800 bg-[#0e0e11] py-1 shadow-lg shadow-black/50"
                role="presentation"
              >
                {panel === 'main' ? (
                  <>
                    <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                      Add filter
                    </p>
                    <button
                      type="button"
                      onClick={() => setPanel('agent')}
                      className="flex w-full items-center justify-between px-2.5 py-1.5 text-left text-[12px] text-zinc-200 hover:bg-zinc-800/70"
                    >
                      Agent
                      <span className="text-zinc-500">›</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPanel('label')}
                      className="flex w-full items-center justify-between px-2.5 py-1.5 text-left text-[12px] text-zinc-200 hover:bg-zinc-800/70"
                    >
                      Label
                      <span className="text-zinc-500">›</span>
                    </button>
                    {showAssigneeFilter ? (
                      <button
                        type="button"
                        onClick={() => setPanel('assignee')}
                        className="flex w-full items-center justify-between px-2.5 py-1.5 text-left text-[12px] text-zinc-200 hover:bg-zinc-800/70"
                      >
                        Assignee
                        <span className="text-zinc-500">›</span>
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setPanel('status')}
                      className="flex w-full items-center justify-between px-2.5 py-1.5 text-left text-[12px] text-zinc-200 hover:bg-zinc-800/70"
                    >
                      Status
                      <span className="text-zinc-500">›</span>
                    </button>
                    {showRepoFilter ? (
                      <button
                        type="button"
                        onClick={() => setPanel('repo')}
                        className="flex w-full items-center justify-between px-2.5 py-1.5 text-left text-[12px] text-zinc-200 hover:bg-zinc-800/70"
                      >
                        Repository
                        <span className="text-zinc-500">›</span>
                      </button>
                    ) : null}
                    {filter.includeDescription ? (
                      <button
                        type="button"
                        onClick={() => {
                          set({ includeDescription: false });
                          setMenuOpen(false);
                        }}
                        className="w-full px-2.5 py-1.5 text-left text-[12px] text-zinc-200 hover:bg-zinc-800/70"
                      >
                        Title only (search)
                      </button>
                    ) : null}
                    {!filter.hideDone ? (
                      <button
                        type="button"
                        onClick={() => {
                          set({ hideDone: true });
                          setMenuOpen(false);
                        }}
                        className="w-full px-2.5 py-1.5 text-left text-[12px] text-zinc-200 hover:bg-zinc-800/70"
                      >
                        Hide done
                      </button>
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
                        <div className="px-2.5 py-2 text-center text-[11px] text-zinc-500">
                          No matches
                        </div>
                      ) : (
                        filteredAgents.map((a) => (
                          <button
                            key={a.id}
                            type="button"
                            role="option"
                            onClick={() => {
                              set({ agent: a.id });
                              setMenuOpen(false);
                            }}
                            className="w-full px-2.5 py-1.5 text-left text-[12px] text-zinc-200 hover:bg-zinc-800/70"
                          >
                            {a.label}
                          </button>
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
                        <div className="px-2.5 py-2 text-center text-[11px] text-zinc-500">
                          No matches
                        </div>
                      ) : (
                        filteredColumns.map((col) => (
                          <button
                            key={col.id}
                            type="button"
                            role="option"
                            onClick={() => {
                              set({ status: col.id });
                              setMenuOpen(false);
                            }}
                            className="w-full px-2.5 py-1.5 text-left text-[12px] text-zinc-200 hover:bg-zinc-800/70"
                          >
                            {col.label}
                          </button>
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
                        <div className="px-2.5 py-2 text-center text-[11px] text-zinc-500">
                          No matches
                        </div>
                      ) : (
                        <>
                          {showUnlabeledRow ? (
                            <button
                              type="button"
                              role="option"
                              onClick={() => {
                                set({ label: UNLABELED_VALUE });
                                setMenuOpen(false);
                              }}
                              className="w-full px-2.5 py-1.5 text-left text-[12px] text-zinc-200 hover:bg-zinc-800/70"
                            >
                              {FILTER_PICKER_UNLABELED_LABEL}
                            </button>
                          ) : null}
                          {filteredLabels.map((lab) => (
                            <button
                              key={lab}
                              type="button"
                              role="option"
                              onClick={() => {
                                set({ label: lab });
                                setMenuOpen(false);
                              }}
                              className="w-full px-2.5 py-1.5 text-left text-[12px] text-zinc-200 hover:bg-zinc-800/70"
                            >
                              {lab}
                            </button>
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
                        <div className="px-2.5 py-2 text-center text-[11px] text-zinc-500">
                          No matches
                        </div>
                      ) : (
                        <>
                          {showUnassignedRow ? (
                            <button
                              type="button"
                              role="option"
                              onClick={() => {
                                set({ assignee: UNASSIGNED_ASSIGNEE_VALUE });
                                setMenuOpen(false);
                              }}
                              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] text-zinc-200 hover:bg-zinc-800/70"
                            >
                              <UserCircle2
                                className="h-5 w-5 shrink-0 text-zinc-500"
                                strokeWidth={1.5}
                                aria-hidden
                              />
                              <span className="min-w-0 flex-1 truncate text-zinc-400">
                                {FILTER_PICKER_UNASSIGNED_LABEL}
                              </span>
                            </button>
                          ) : null}
                          {filteredAssignees.map((member) => (
                            <button
                              key={member.uid}
                              type="button"
                              role="option"
                              onClick={() => {
                                set({ assignee: member.uid });
                                setMenuOpen(false);
                              }}
                              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] text-zinc-200 hover:bg-zinc-800/70"
                            >
                              <ProjectMemberAvatar member={member} size="xs" />
                              <span className="min-w-0 flex-1 truncate">
                                {projectMemberDisplayLabel(member)}
                              </span>
                            </button>
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
                        <div className="px-2.5 py-2 text-center text-[11px] text-zinc-500">
                          No matches
                        </div>
                      ) : (
                        filteredRepos.map((r) => (
                          <button
                            key={r.id}
                            type="button"
                            role="option"
                            onClick={() => {
                              set({ repoId: r.id });
                              setMenuOpen(false);
                            }}
                            className="w-full px-2.5 py-1.5 text-left text-[12px] text-zinc-200 hover:bg-zinc-800/70"
                          >
                            {repoDisplayLabel(r)}
                          </button>
                        ))
                      )}
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}
        </div>
        </div>
      </div>
    </div>
  );
}
