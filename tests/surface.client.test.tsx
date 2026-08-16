// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FirstmateSurface } from '../src/firstmate-web/client/FirstmateSurface.tsx'
import { FirstmateUiController } from '../src/firstmate-web/client/controller.ts'
import type { FirstmateRemoteMethods } from '../src/firstmate-web/client/shims.ts'
import type { DashboardSnapshot } from '../src/shared/types.ts'
import { taskFixture } from './helpers.ts'

const mounted: { root: ReturnType<typeof createRoot>; controller: FirstmateUiController; host: HTMLElement }[] = []

afterEach(async () => {
  await act(async () => {
    for (const item of mounted.splice(0)) {
      item.controller.hide()
      item.root.unmount()
      item.host.remove()
    }
  })
})

describe('FirstmateSurface', () => {
  it('preserves a drafted decision across polling refreshes and exposes attention filters', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const decision = taskFixture({
      status: 'decision_required',
      decision: { question: 'Choose the persistence engine', requestedAt: '2026-08-15T08:01:00.000Z' },
      worker: {
        id: 'worker-1',
        provider: 'fake',
        attempt: 1,
        lastHeartbeatAt: '2026-08-15T08:01:00.000Z',
      },
    })
    const snapshot: DashboardSnapshot = {
      tasks: [decision],
      counts: { decision_required: 1, review_ready: 0, blocked: 0, running: 0, queued: 0, completed: 0 },
      generatedAt: '2026-08-15T08:01:00.000Z',
    }
    const remote: FirstmateRemoteMethods = {
      snapshot: vi.fn(async () => structuredClone(snapshot)),
      submit: vi.fn(async () => ({ taskIds: [] })),
      decision: vi.fn(async () => undefined),
      review: vi.fn(async () => undefined),
      retry: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
    }
    const controller = new FirstmateUiController()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    mounted.push({ root, controller, host })

    await act(async () => {
      root.render(<FirstmateSurface controller={controller} remote={remote} />)
      controller.show()
    })
    await vi.waitFor(() => expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Decision response"]')).not.toBeNull())
    const response = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Decision response"]')!

    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setValue?.call(response, 'Use SQLite')
      response.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(response.value).toBe('Use SQLite')

    const refresh = host.querySelector<HTMLButtonElement>('button[aria-label="Refresh tasks"]')!
    await act(async () => { refresh.click() })
    await vi.waitFor(() => expect(remote.snapshot).toHaveBeenCalledTimes(2))
    expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Decision response"]')).toBe(response)
    expect(response.value).toBe('Use SQLite')

    const decisions = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Decisions'))
    await act(async () => { decisions?.click() })
    expect(host.querySelector('main h2')?.textContent).toBe('Decisions')
  })
})
