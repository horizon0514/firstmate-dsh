import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DSH_VERSION = '0.1.0-rc.6'
const COMMAND_TIMEOUT_MS = 15 * 60_000
const START_TIMEOUT_MS = 90_000
const MAX_OUTPUT_CHARS = 8 * 1024 * 1024
const project = resolve(import.meta.dirname, '..')
const dshHome = await mkdtemp(join(tmpdir(), 'firstmate-dsh-smoke-'))
const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const environment = { ...process.env, DSH_HOME: dshHome }
let server
let serverOutput = ''

function args(command) {
  return ['--yes', `@deepseek-ai/dsh@${DSH_VERSION}`, ...command]
}

function cleanOutput(value) {
  return value.replaceAll(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
}

async function run(command, captureStdout = false) {
  const child = spawn(executable, args(command), {
    cwd: project,
    env: environment,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const collect = chunk => {
    output = `${output}${chunk.toString()}`.slice(-MAX_OUTPUT_CHARS)
  }
  child.stdout.on('data', chunk => {
    collect(chunk)
    if (!captureStdout) process.stdout.write(chunk)
  })
  child.stderr.on('data', chunk => {
    collect(chunk)
    process.stderr.write(chunk)
  })

  return await new Promise((resolveOutput, reject) => {
    let settled = false
    let timedOut = false
    let forced
    const settle = callback => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (forced !== undefined) clearTimeout(forced)
      callback()
    }
    const timer = setTimeout(() => {
      timedOut = true
      terminateTree(child, 'SIGTERM')
      forced = setTimeout(() => {
        terminateTree(child, 'SIGKILL')
        child.stdout.destroy()
        child.stderr.destroy()
        settle(() => reject(new Error(
          `DSH command timed out after ${COMMAND_TIMEOUT_MS}ms: ${command.join(' ')}\n${cleanOutput(output)}`,
        )))
      }, 10_000)
    }, COMMAND_TIMEOUT_MS)
    child.once('error', error => settle(() => reject(error)))
    child.once('close', (code, signal) => {
      const clean = cleanOutput(output)
      if (timedOut) {
        settle(() => reject(new Error(`DSH command timed out after ${COMMAND_TIMEOUT_MS}ms: ${command.join(' ')}\n${clean}`)))
      } else if (code !== 0) {
        settle(() => reject(new Error(`DSH command failed (code ${code}, signal ${signal}): ${command.join(' ')}\n${clean}`)))
      } else {
        settle(() => resolveOutput(clean))
      }
    })
  })
}

function terminateTree(child, signal) {
  if (child.pid === undefined) return
  try {
    if (process.platform === 'win32') child.kill(signal)
    else process.kill(-child.pid, signal)
  } catch {
    child.kill(signal)
  }
}

async function startWeb() {
  const child = spawn(executable, args(['web', '--host', '127.0.0.1', '--port', '0']), {
    cwd: project,
    env: environment,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server = child

  return await new Promise((resolveUrl, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`DSH Web did not become ready within ${START_TIMEOUT_MS}ms\n${cleanOutput(serverOutput)}`))
    }, START_TIMEOUT_MS)
    const inspect = chunk => {
      serverOutput = `${serverOutput}${chunk.toString()}`.slice(-256_000)
      const match = cleanOutput(serverOutput).match(/dsh web:\s+(http:\/\/127\.0\.0\.1:\d+)/)
      if (match?.[1] === undefined) return
      clearTimeout(timer)
      resolveUrl(match[1])
    }
    child.stdout.on('data', inspect)
    child.stderr.on('data', inspect)
    child.once('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      reject(new Error(`DSH Web exited before readiness (code ${code}, signal ${signal})\n${cleanOutput(serverOutput)}`))
    })
  })
}

async function stopWeb() {
  if (server === undefined || server.exitCode !== null || server.signalCode !== null) return
  terminateTree(server, 'SIGTERM')
  if (!await waitForExit(server, 10_000)) {
    terminateTree(server, 'SIGKILL')
    await waitForExit(server, 2_000)
  }
  server.stdout.destroy()
  server.stderr.destroy()
  server.unref()
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise(resolveExit => {
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit)
      resolveExit(false)
    }, timeoutMs)
    const onExit = () => {
      clearTimeout(timer)
      resolveExit(true)
    }
    child.once('exit', onExit)
  })
}

try {
  console.log(`Installing Firstmate into an isolated DSH ${DSH_VERSION} Web profile...`)
  await run(['plugin', '--profile', 'web', 'add', project])

  console.log('Verifying the composed DSH profile...')
  const config = await run(['web', '--dump-config'], true)
  assert.match(config, /- id: firstmate\s+name: firstmate-dsh/)
  assert.match(config, /- id: agent\s+name: '@deepseek-ai\/dsh-agent'/)
  assert.match(config, /- id: subagent\s+name: '@deepseek-ai\/dsh-subagent'/)
  assert.match(config, /- id: tool-subagent-report\s+name: '@deepseek-ai\/dsh-tool-subagent-report'/)
  assert.match(config, /- id: session-persistence-jsonl\s+name: '@deepseek-ai\/dsh-session-persistence-jsonl'/)

  console.log('Starting the isolated DSH Web host...')
  const url = await startWeb()
  const page = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  assert.equal(page.status, 200, 'DSH Web root did not return HTTP 200')
  assert.match(await page.text(), /DeepSeek Harness/)

  const client = await fetch(`${url}/plugins/firstmate-dsh/client.js`, {
    signal: AbortSignal.timeout(10_000),
  })
  assert.equal(client.status, 200, 'Firstmate client bundle did not return HTTP 200')
  assert.match(await client.text(), /firstmate-dsh/)

  const snapshot = await fetch(`${url}/api/firstmate/snapshot`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: 'firstmate-dsh-smoke',
      method: 'firstmate/snapshot',
      payload: { args: {} },
    }),
    signal: AbortSignal.timeout(10_000),
  })
  assert.equal(snapshot.status, 200, 'Firstmate Host Remote did not return HTTP 200')
  const response = await snapshot.json()
  assert.equal(response.result?.ok, true, JSON.stringify(response))
  assert.deepEqual(response.result.value.tasks, [])

  console.log(`DSH smoke passed: firstmate-dsh installs and starts in DSH ${DSH_VERSION}.`)
} catch (error) {
  if (serverOutput !== '') console.error(cleanOutput(serverOutput))
  throw error
} finally {
  await stopWeb()
  await rm(dshHome, { recursive: true, force: true })
}
