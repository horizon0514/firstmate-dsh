import type { Context } from '@deepseek-ai/cordis'
import { FIRSTMATE_REMOTE } from './contribution.ts'
import { FirstmateUiController } from './controller.ts'
import { FirstmateSidebarAction } from './FirstmateSidebarAction.tsx'
import { FirstmateSurface } from './FirstmateSurface.tsx'
import type { FirstmateRemoteMethods, FirstmateRemoteNamespace } from './shims.ts'
import type {} from './shims.ts'

export const name = 'firstmate-web'
export const inject = ['remote', 'slots']

export async function apply(ctx: Context): Promise<void> {
  await ctx.remote.$mount(FIRSTMATE_REMOTE)
  const controller = new FirstmateUiController()
  const namespace = ctx.get('remote.firstmate') as FirstmateRemoteNamespace | undefined
  if (namespace === undefined) throw new Error('Firstmate Remote namespace did not mount')
  const remote = createFirstmateRemote(namespace)

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'firstmate',
    order: 10,
  }, props => <FirstmateSidebarAction {...props} controller={controller} />))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'firstmate',
    order: 10,
  }, () => <FirstmateSurface controller={controller} remote={remote} />))
}

export function createFirstmateRemote(namespace: FirstmateRemoteNamespace): FirstmateRemoteMethods {
  return {
    snapshot: async () => unwrap(await namespace.snapshot()),
    submit: async request => unwrap(await namespace.submit(request)),
    decision: async request => unwrap(await namespace.decision(request)),
    review: async request => unwrap(await namespace.review(request)),
    retry: async request => unwrap(await namespace.retry(request)),
    cancel: async request => unwrap(await namespace.cancel(request)),
  }
}

function unwrap<T>(result: import('@deepseek-ai/dsh-typert-protocol').RemoteResult<T>): T {
  if (result.ok) return result.value
  throw new Error(`Firstmate Remote failed: ${result.error.code}: ${result.error.message}`)
}
