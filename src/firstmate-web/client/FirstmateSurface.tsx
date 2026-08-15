import {
  AlertTriangle,
  Ban,
  Check,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Clock3,
  FileCode2,
  FlaskConical,
  FolderGit2,
  Inbox,
  ListTodo,
  Plus,
  RefreshCw,
  RotateCcw,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { DashboardSnapshot, FirstmateTask, TaskInput, TaskStatus } from '../../shared/types.ts'
import type { FirstmateUiController } from './controller.ts'
import type { FirstmateRemoteMethods } from './shims.ts'
import { TaskComposer } from './TaskComposer.tsx'
import css from './FirstmateSurface.module.css'

type Filter = 'attention' | 'decision_required' | 'review_ready' | 'blocked' | 'running' | 'queued' | 'completed'

const FILTERS: readonly { id: Filter; label: string; icon: typeof Inbox }[] = [
  { id: 'attention', label: 'Attention', icon: Inbox },
  { id: 'decision_required', label: 'Decisions', icon: CircleHelp },
  { id: 'review_ready', label: 'Ready for review', icon: ClipboardCheck },
  { id: 'blocked', label: 'Blocked', icon: AlertTriangle },
  { id: 'running', label: 'In progress', icon: RefreshCw },
  { id: 'queued', label: 'Queued', icon: Clock3 },
  { id: 'completed', label: 'Completed', icon: Check },
]

const STATUS_LABELS: Readonly<Record<TaskStatus, string>> = {
  queued: 'Queued',
  running: 'In progress',
  decision_required: 'Decision needed',
  review_ready: 'Ready for review',
  blocked: 'Blocked',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export interface FirstmateSurfaceProps {
  readonly controller: FirstmateUiController
  readonly remote: FirstmateRemoteMethods
}

export function FirstmateSurface({ controller, remote }: FirstmateSurfaceProps) {
  const open = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>()
  const [filter, setFilter] = useState<Filter>('attention')
  const [selectedId, setSelectedId] = useState<string>()
  const [mobileDetail, setMobileDetail] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const refresh = useCallback(async (quiet = false): Promise<void> => {
    try {
      const next = await remote.snapshot()
      setSnapshot(next)
      setError(undefined)
    } catch (reason: unknown) {
      if (!quiet) setError(renderError(reason))
    }
  }, [remote])

  useEffect(() => {
    if (!open) return
    void refresh()
    const timer = window.setInterval(() => { void refresh(true) }, 1_500)
    return () => window.clearInterval(timer)
  }, [open, refresh])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (composerOpen) setComposerOpen(false)
      else controller.hide()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [composerOpen, controller, open])

  const tasks = useMemo(() => snapshot?.tasks.filter(task => matchesFilter(task, filter)) ?? [], [filter, snapshot])
  const selected = tasks.find(task => task.id === selectedId)

  useEffect(() => {
    setSelectedId(current => tasks.some(task => task.id === current) ? current : tasks[0]?.id)
  }, [tasks])

  const selectFilter = (next: Filter): void => {
    setFilter(next)
    setMobileDetail(false)
  }

  const run = async (operation: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      await operation()
      await refresh()
    } catch (reason: unknown) {
      setError(renderError(reason))
      throw reason
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null
  return (
    <section className={css.surface} aria-label="Firstmate task manager">
      <header className={css.topbar}>
        <div className={css.brand}>
          <span className={css.mark}>FM</span>
          <div>
            <h1>Firstmate</h1>
            <p>Software task command</p>
          </div>
        </div>
        <div className={css.attentionSummary} aria-label="Attention inbox counts">
          <SummaryCount tone="decision" label="Decisions" value={snapshot?.counts.decision_required ?? 0} onClick={() => selectFilter('decision_required')} />
          <SummaryCount tone="review" label="Reviews" value={snapshot?.counts.review_ready ?? 0} onClick={() => selectFilter('review_ready')} />
          <SummaryCount tone="blocked" label="Blocked" value={snapshot?.counts.blocked ?? 0} onClick={() => selectFilter('blocked')} />
        </div>
        <div className={css.topCommands}>
          <button type="button" className={css.primary} onClick={() => setComposerOpen(true)}>
            <Plus aria-hidden="true" size={16} /> Delegate
          </button>
          <button type="button" className={css.iconButton} aria-label="Close Firstmate" onClick={controller.hide}>
            <X aria-hidden="true" size={19} />
          </button>
        </div>
      </header>

      {error !== undefined && (
        <div className={css.errorBanner} role="alert">
          <AlertTriangle aria-hidden="true" size={16} />
          <span>{error}</span>
          <button type="button" aria-label="Dismiss error" onClick={() => setError(undefined)}><X aria-hidden="true" size={15} /></button>
        </div>
      )}

      <div className={css.workspace}>
        <nav className={css.filters} aria-label="Task views">
          {FILTERS.map(item => {
            const Icon = item.icon
            const count = countFor(snapshot, item.id)
            return (
              <button key={item.id} type="button" aria-current={filter === item.id ? 'page' : undefined} onClick={() => selectFilter(item.id)}>
                <Icon aria-hidden="true" size={16} />
                <span>{item.label}</span>
                <strong>{count}</strong>
              </button>
            )
          })}
        </nav>

        <main className={css.taskPane}>
          <div className={css.paneHeader}>
            <div>
              <h2>{FILTERS.find(item => item.id === filter)?.label}</h2>
              <p>{tasks.length} task{tasks.length === 1 ? '' : 's'}</p>
            </div>
            <button type="button" className={css.iconButton} aria-label="Refresh tasks" onClick={() => { void refresh() }}>
              <RefreshCw aria-hidden="true" size={17} />
            </button>
          </div>
          <div className={css.taskList}>
            {snapshot === undefined && <div className={css.empty}>Loading task ledger...</div>}
            {snapshot !== undefined && tasks.length === 0 && (
              <div className={css.empty}>
                <ClipboardCheck aria-hidden="true" size={24} />
                <span>No tasks in this view</span>
              </div>
            )}
            {tasks.map(task => (
              <TaskRow key={task.id} task={task} selected={task.id === selectedId} onSelect={() => {
                setSelectedId(task.id)
                setMobileDetail(true)
              }} />
            ))}
          </div>
        </main>

        <aside className={css.detailPane} data-visible={mobileDetail || undefined} aria-label="Selected task details">
          <button type="button" className={css.mobileBack} onClick={() => setMobileDetail(false)}>Back to tasks</button>
          {selected === undefined
            ? <div className={css.empty}>Select a task to inspect its result</div>
            : <TaskDetail key={selected.id} task={selected} busy={busy} run={run} remote={remote} />}
        </aside>
      </div>

      {composerOpen && (
        <TaskComposer
          busy={busy}
          onClose={() => setComposerOpen(false)}
          onSubmit={async (tasks: readonly TaskInput[]) => {
            await run(async () => { await remote.submit({ tasks }) })
            setComposerOpen(false)
          }}
        />
      )}
    </section>
  )
}

function TaskDetail({ task, busy: taskBusy, run: runTask, remote }: {
  readonly task: FirstmateTask
  readonly busy: boolean
  readonly run: (operation: () => Promise<void>) => Promise<void>
  readonly remote: FirstmateRemoteMethods
}) {
    const [response, setResponse] = useState('')
    return (
      <div className={css.detail}>
        <div className={css.detailHeader}>
          <StatusBadge status={task.status} />
          <h2>{task.title}</h2>
          <p className={css.path}><FolderGit2 aria-hidden="true" size={14} /> {task.workspace}</p>
        </div>

        <DetailSection title="Goal"><p>{task.goal}</p></DetailSection>
        {task.acceptanceCriteria.length > 0 && (
          <DetailSection title="Acceptance criteria">
            <ul>{task.acceptanceCriteria.map(criterion => <li key={criterion}>{criterion}</li>)}</ul>
          </DetailSection>
        )}

        {task.status === 'decision_required' && task.decision !== undefined && (
          <section className={css.actionSection} data-tone="decision">
            <div className={css.actionTitle}><CircleHelp aria-hidden="true" size={17} /><h3>Decision needed</h3></div>
            <p>{task.decision.question}</p>
            <textarea aria-label="Decision response" rows={3} value={response} onChange={event => setResponse(event.target.value)} placeholder="Enter the decision" />
            <button type="button" className={css.primary} disabled={taskBusy || response.trim() === ''} onClick={() => {
              void runTask(async () => {
                await remote.decision({ taskId: task.id, answer: response })
                setResponse('')
              }).catch(() => undefined)
            }}>Send decision</button>
          </section>
        )}

        {task.status === 'blocked' && task.blocked !== undefined && (
          <section className={css.actionSection} data-tone="blocked">
            <div className={css.actionTitle}><AlertTriangle aria-hidden="true" size={17} /><h3>Blocked</h3></div>
            <p>{task.blocked.reason}</p>
            <div className={css.actions}>
              <button type="button" className={css.primary} disabled={taskBusy} onClick={() => { void runTask(() => remote.retry({ taskId: task.id })).catch(() => undefined) }}>
                <RotateCcw aria-hidden="true" size={15} /> Retry
              </button>
              <button type="button" className={css.danger} disabled={taskBusy} onClick={() => { void runTask(() => remote.cancel({ taskId: task.id })).catch(() => undefined) }}>
                <Ban aria-hidden="true" size={15} /> Cancel
              </button>
            </div>
          </section>
        )}

        {task.result !== undefined && (
          <>
            <DetailSection title="Completed work"><p>{task.result.summary}</p></DetailSection>
            <DetailSection title="Changed files" icon={FileCode2}>
              {task.result.files.length === 0 ? <p>None reported</p> : <ul className={css.fileList}>{task.result.files.map(file => <li key={file}>{file}</li>)}</ul>}
            </DetailSection>
            <DetailSection title="Tests" icon={FlaskConical}>
              {task.result.tests.length === 0
                ? <p>No tests reported</p>
                : <ul className={css.testList}>{task.result.tests.map((test, index) => (
                    <li key={`${test.command}-${index}`} data-outcome={test.outcome}>
                      <code>{test.command}</code><span>{test.summary}</span>
                    </li>
                  ))}</ul>}
            </DetailSection>
            {(task.result.diff !== undefined || task.result.commit !== undefined) && (
              <DetailSection title="Git evidence">
                {task.result.commit !== undefined && <p className={css.commit}>Commit <code>{task.result.commit}</code></p>}
                {task.result.diff !== undefined && <pre className={css.diff}>{task.result.diff}</pre>}
              </DetailSection>
            )}
            {(task.result.risks.length > 0 || task.result.incomplete.length > 0) && (
              <DetailSection title="Risks and remaining work">
                <ul>{[...task.result.risks, ...task.result.incomplete].map(item => <li key={item}>{item}</li>)}</ul>
              </DetailSection>
            )}
          </>
        )}

        {task.status === 'review_ready' && (
          <section className={css.reviewActions}>
            <h3>Review result</h3>
            <textarea aria-label="Revision feedback" rows={3} value={response} onChange={event => setResponse(event.target.value)} placeholder="Feedback required only when requesting changes" />
            <div className={css.actions}>
              <button type="button" className={css.accept} disabled={taskBusy} onClick={() => { void runTask(() => remote.review({ taskId: task.id, action: 'accept' })).catch(() => undefined) }}>
                <Check aria-hidden="true" size={15} /> Accept
              </button>
              <button type="button" className={css.secondary} disabled={taskBusy || response.trim() === ''} onClick={() => {
                void runTask(async () => {
                  await remote.review({ taskId: task.id, action: 'revise', feedback: response })
                  setResponse('')
                }).catch(() => undefined)
              }}>
                <RotateCcw aria-hidden="true" size={15} /> Request changes
              </button>
              <button type="button" className={css.danger} disabled={taskBusy} onClick={() => { void runTask(() => remote.review({ taskId: task.id, action: 'cancel' })).catch(() => undefined) }}>
                <Ban aria-hidden="true" size={15} /> Cancel
              </button>
            </div>
          </section>
        )}

        {(task.status === 'running' || task.status === 'queued') && (
          <div className={css.passiveActions}>
            <button type="button" className={css.danger} disabled={taskBusy} onClick={() => { void runTask(() => remote.cancel({ taskId: task.id })).catch(() => undefined) }}>
              <Ban aria-hidden="true" size={15} /> Cancel task
            </button>
          </div>
        )}
      </div>
  )
}

function SummaryCount({ tone, label, value, onClick }: {
  readonly tone: string
  readonly label: string
  readonly value: number
  readonly onClick: () => void
}) {
  return <button type="button" className={css.summaryCount} data-tone={tone} onClick={onClick}><strong>{value}</strong><span>{label}</span></button>
}

function TaskRow({ task, selected, onSelect }: { readonly task: FirstmateTask; readonly selected: boolean; readonly onSelect: () => void }) {
  return (
    <button type="button" className={css.taskRow} aria-pressed={selected} onClick={onSelect}>
      <span className={css.rowMain}>
        <span className={css.rowTop}><StatusBadge status={task.status} /><time>{relativeTime(task.updatedAt)}</time></span>
        <strong>{task.title}</strong>
        <span className={css.rowPath}>{task.workspace}</span>
      </span>
      <ChevronRight aria-hidden="true" size={17} />
    </button>
  )
}

function StatusBadge({ status }: { readonly status: TaskStatus }) {
  return <span className={css.status} data-status={status}>{STATUS_LABELS[status]}</span>
}

function DetailSection({ title, icon: Icon, children }: {
  readonly title: string
  readonly icon?: typeof ListTodo
  readonly children: React.ReactNode
}) {
  return (
    <section className={css.detailSection}>
      <h3>{Icon !== undefined && <Icon aria-hidden="true" size={15} />}{title}</h3>
      {children}
    </section>
  )
}

function matchesFilter(task: FirstmateTask, filter: Filter): boolean {
  if (filter === 'attention') return ['decision_required', 'review_ready', 'blocked'].includes(task.status)
  return task.status === filter
}

function countFor(snapshot: DashboardSnapshot | undefined, filter: Filter): number {
  if (snapshot === undefined) return 0
  if (filter === 'attention') return snapshot.counts.decision_required + snapshot.counts.review_ready + snapshot.counts.blocked
  return snapshot.counts[filter]
}

function relativeTime(timestamp: string): string {
  const elapsed = Date.now() - Date.parse(timestamp)
  if (elapsed < 60_000) return 'now'
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h`
  return `${Math.floor(elapsed / 86_400_000)}d`
}

function renderError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
