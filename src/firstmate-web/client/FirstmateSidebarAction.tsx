import { Compass } from 'lucide-react'
import type { SidebarActionProps } from './shims.ts'
import type { FirstmateUiController } from './controller.ts'
import css from './FirstmateSidebarAction.module.css'

export function FirstmateSidebarAction({
  wide,
  controller,
}: SidebarActionProps & { controller: FirstmateUiController }) {
  return (
    <button
      type="button"
      className={css.action}
      aria-label="Open Firstmate"
      title={wide ? undefined : 'Firstmate'}
      onClick={controller.show}
    >
      <Compass aria-hidden="true" size={wide ? 16 : 18} strokeWidth={1.8} />
      {wide && <span>Firstmate</span>}
    </button>
  )
}
