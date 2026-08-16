import { Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import type { TaskInput } from '../../shared/types.ts'
import css from './TaskComposer.module.css'

interface DraftTask {
  readonly key: number
  readonly title: string
  readonly workspace: string
  readonly goal: string
  readonly context: string
  readonly acceptance: string
}

let nextKey = 1

function emptyTask(): DraftTask {
  return { key: nextKey++, title: '', workspace: '', goal: '', context: '', acceptance: '' }
}

export interface TaskComposerProps {
  readonly busy: boolean
  readonly onClose: () => void
  readonly onSubmit: (tasks: readonly TaskInput[]) => Promise<void>
}

export function TaskComposer({ busy, onClose, onSubmit }: TaskComposerProps) {
  const [drafts, setDrafts] = useState<DraftTask[]>([emptyTask()])
  const [error, setError] = useState<string>()

  const patch = (key: number, values: Partial<DraftTask>): void => {
    setDrafts(current => current.map(draft => draft.key === key ? { ...draft, ...values } : draft))
  }

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setError(undefined)
    const tasks: TaskInput[] = drafts.map(draft => ({
      title: draft.title,
      workspace: draft.workspace,
      goal: draft.goal,
      context: draft.context,
      acceptanceCriteria: draft.acceptance.split('\n').map(line => line.trim()).filter(Boolean),
    }))
    try {
      await onSubmit(tasks)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  return (
    <div className={css.backdrop} role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget && !busy) onClose()
    }}>
      <form className={css.dialog} role="dialog" aria-modal="true" aria-labelledby="firstmate-compose-title" onSubmit={event => { void submit(event) }}>
        <header className={css.header}>
          <div>
            <h2 id="firstmate-compose-title">Delegate tasks</h2>
            <p>{drafts.length} task{drafts.length === 1 ? '' : 's'} in this dispatch</p>
          </div>
          <button type="button" className={css.iconButton} aria-label="Close task composer" onClick={onClose} disabled={busy}>
            <X aria-hidden="true" size={18} />
          </button>
        </header>

        <div className={css.taskList}>
          {drafts.map((draft, index) => (
            <fieldset key={draft.key} className={css.task}>
              <legend>Task {index + 1}</legend>
              {drafts.length > 1 && (
                <button
                  type="button"
                  className={css.remove}
                  aria-label={`Remove task ${index + 1}`}
                  onClick={() => setDrafts(current => current.filter(item => item.key !== draft.key))}
                >
                  <Trash2 aria-hidden="true" size={16} />
                </button>
              )}
              <label>
                <span>Title</span>
                <input required value={draft.title} onChange={event => patch(draft.key, { title: event.target.value })} placeholder="Fix flaky checkout test" />
              </label>
              <label>
                <span>Workspace</span>
                <input required value={draft.workspace} onChange={event => patch(draft.key, { workspace: event.target.value })} placeholder="/absolute/path/to/repository" spellCheck={false} />
              </label>
              <label className={css.full}>
                <span>Goal</span>
                <textarea required rows={2} value={draft.goal} onChange={event => patch(draft.key, { goal: event.target.value })} placeholder="Describe the desired software outcome" />
              </label>
              <label>
                <span>Context</span>
                <textarea rows={3} value={draft.context} onChange={event => patch(draft.key, { context: event.target.value })} placeholder="Relevant constraints, links, or background" />
              </label>
              <label>
                <span>Acceptance criteria</span>
                <textarea rows={3} value={draft.acceptance} onChange={event => patch(draft.key, { acceptance: event.target.value })} placeholder={'One observable criterion per line'} />
              </label>
            </fieldset>
          ))}
        </div>

        {error !== undefined && <p className={css.error} role="alert">{error}</p>}
        <footer className={css.footer}>
          <button type="button" className={css.add} onClick={() => setDrafts(current => [...current, emptyTask()])} disabled={busy || drafts.length >= 20}>
            <Plus aria-hidden="true" size={16} /> Add task
          </button>
          <div className={css.commands}>
            <button type="button" className={css.secondary} onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className={css.primary} disabled={busy}>{busy ? 'Dispatching...' : `Dispatch ${drafts.length}`}</button>
          </div>
        </footer>
      </form>
    </div>
  )
}
