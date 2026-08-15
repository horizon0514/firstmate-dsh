import type { ReactNode } from 'react'
import type { RemoteResult, TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type {
  DashboardSnapshot,
  DecisionResponseRequest,
  ReviewActionRequest,
  SubmitTasksRequest,
  SubmitTasksResult,
  TaskActionRequest,
} from '../../shared/types.ts'

export interface FirstmateRemoteMethods {
  snapshot(): Promise<DashboardSnapshot>
  submit(request: SubmitTasksRequest): Promise<SubmitTasksResult>
  decision(request: DecisionResponseRequest): Promise<void>
  review(request: ReviewActionRequest): Promise<void>
  retry(request: TaskActionRequest): Promise<void>
  cancel(request: TaskActionRequest): Promise<void>
}

export interface FirstmateRemoteNamespace {
  snapshot(): Promise<RemoteResult<DashboardSnapshot>>
  submit(request: SubmitTasksRequest): Promise<RemoteResult<SubmitTasksResult>>
  decision(request: DecisionResponseRequest): Promise<RemoteResult<void>>
  review(request: ReviewActionRequest): Promise<RemoteResult<void>>
  retry(request: TaskActionRequest): Promise<RemoteResult<void>>
  cancel(request: TaskActionRequest): Promise<RemoteResult<void>>
}

export interface ClientSlotOptions {
  readonly name: string
  readonly id?: string
  readonly order?: number
}

export interface SidebarActionProps {
  readonly wide: boolean
}

export interface ClientSlotRegistry {
  register(options: ClientSlotOptions, component: (props: any) => ReactNode): () => void
  inject(key: string, callback: () => () => void): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    slots: ClientSlotRegistry
    remote: TypertClientRemote
  }
}
