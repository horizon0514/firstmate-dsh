import type {
  InvocationDescriptor,
  InvocationParameterDescriptor,
  TypertCodec,
  TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'

const OWNER = 'firstmate-dsh'

function strict(typeSymbol: string, parse: (value: unknown) => unknown): TypertCodec {
  return { mode: 'strict', typeSymbol, schema: { parse } }
}

function object(label: string): (value: unknown) => object {
  return value => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new TypeError(`${label} must be an object`)
    }
    return value
  }
}

function voidResult(value: unknown): undefined {
  if (value !== undefined && value !== null) throw new TypeError('expected an empty result')
  return undefined
}

function query(method: string, result: TypertCodec): InvocationDescriptor {
  return {
    id: `${OWNER}#firstmate/${method}`,
    service: 'firstmate',
    namespace: 'firstmate',
    method,
    invocation: { kind: 'direct' },
    parameters: [],
    result,
  }
}

// The request type symbol has to be the one the Host publishes in typert.ts, not one
// derived from the method name — DSH matches routes on the symbol, not on the method.
function command(
  method: string,
  requestType: string,
  parse: (value: unknown) => unknown,
  result: TypertCodec,
): InvocationDescriptor {
  const parameter: InvocationParameterDescriptor = {
    name: 'request',
    wire: 'request',
    source: 'json',
    codec: strict(`${OWNER}#${requestType}`, parse),
  }
  return { ...query(method, result), parameters: [parameter] }
}

function taskAction(label: string): (value: unknown) => object {
  return value => {
    const request = object(label)(value) as { taskId?: unknown }
    if (typeof request.taskId !== 'string' || request.taskId === '') {
      throw new TypeError(`${label} needs a taskId`)
    }
    return request
  }
}

export const FIRSTMATE_REMOTE: TypertRemoteContribution = {
  package: OWNER,
  descriptors: [
    query('snapshot', strict(`${OWNER}#DashboardSnapshot`, value => {
      const snapshot = object('Firstmate snapshot')(value) as { tasks?: unknown; counts?: unknown }
      if (!Array.isArray(snapshot.tasks)) throw new TypeError('Firstmate snapshot needs tasks')
      object('Firstmate snapshot counts')(snapshot.counts)
      return snapshot
    })),
    command('submit', 'SubmitTasksRequest', value => {
      const request = object('Firstmate submission')(value) as { tasks?: unknown }
      if (!Array.isArray(request.tasks) || request.tasks.length === 0) {
        throw new TypeError('Firstmate submission needs tasks')
      }
      return request
    }, strict(`${OWNER}#SubmitTasksResult`, object('Firstmate submission result'))),
    command('decision', 'DecisionResponseRequest', value => {
      const request = taskAction('Firstmate decision')(value) as { answer?: unknown }
      if (typeof request.answer !== 'string' || request.answer.trim() === '') {
        throw new TypeError('Firstmate decision needs an answer')
      }
      return request
    }, strict(`${OWNER}#Void`, voidResult)),
    command('review', 'ReviewActionRequest', value => {
      const request = taskAction('Firstmate review')(value) as { action?: unknown }
      if (!['accept', 'revise', 'cancel'].includes(String(request.action))) {
        throw new TypeError('Firstmate review needs a supported action')
      }
      return request
    }, strict(`${OWNER}#Void`, voidResult)),
    command('retry', 'TaskActionRequest', taskAction('Firstmate retry'), strict(`${OWNER}#Void`, voidResult)),
    command('cancel', 'TaskActionRequest', taskAction('Firstmate cancellation'), strict(`${OWNER}#Void`, voidResult)),
  ],
}
