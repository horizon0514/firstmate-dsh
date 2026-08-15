import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const DSH_VERSION = '0.1.0-rc.6'
const COMMAND_TIMEOUT_MS = 5 * 60_000
const START_TIMEOUT_MS = 90_000
const execFileAsync = promisify(execFile)
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

async function run(command) {
  const { stdout, stderr } = await execFileAsync(executable, args(command), {
    cwd: project,
    env: environment,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    timeout: COMMAND_TIMEOUT_MS,
  })
  return cleanOutput(`${stdout}\n${stderr}`)
}

async function startWeb() {
  const child = spawn(executable, args(['web', '--host', '127.0.0.1', '--port', '0']), {
    cwd: project,
    env: environment,
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
  server.kill('SIGTERM')
  const forced = setTimeout(() => { server?.kill('SIGKILL') }, 10_000)
  forced.unref?.()
  try {
    await once(server, 'exit')
  } finally {
    clearTimeout(forced)
  }
}

try {
  await run(['plugin', '--profile', 'web', 'add', project])

  const config = await run(['web', '--dump-config'])
  assert.match(config, /- id: firstmate\s+name: firstmate-dsh/)

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
