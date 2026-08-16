import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const project = resolve(import.meta.dirname, '..')
const root = await mkdtemp(join(tmpdir(), 'firstmate-package-smoke-'))

try {
  const { stdout } = await execFileAsync('npm', [
    'pack', '--json', '--ignore-scripts', '--pack-destination', root,
  ], { cwd: project, maxBuffer: 4 * 1024 * 1024 })
  const packed = JSON.parse(stdout)
  const filename = packed[0]?.filename
  assert.equal(typeof filename, 'string', 'npm pack did not report a tarball')
  const tarball = join(root, basename(filename))
  const { stdout: listing } = await execFileAsync('tar', ['-tf', tarball])
  for (const required of [
    'package/package.json',
    'package/cordis.patch.yml',
    'package/lib/index.js',
    'package/lib/client.js',
    'package/lib/firstmate-web/typert.js',
    'package/lib/types/index.d.ts',
  ]) {
    assert(listing.split('\n').includes(required), `packed artifact is missing ${required}`)
  }

  const consumer = join(root, 'consumer')
  await writeFile(join(root, 'package.json'), '{}\n')
  await execFileAsync('mkdir', ['-p', consumer])
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }, null, 2))
  await execFileAsync('npm', [
    'install', '--ignore-scripts', '--no-audit', '--no-fund', '--legacy-peer-deps', tarball,
  ], { cwd: consumer, maxBuffer: 4 * 1024 * 1024 })
  const installed = JSON.parse(await readFile(join(consumer, 'node_modules', 'firstmate-dsh', 'package.json'), 'utf8'))
  assert.equal(installed.version, '0.1.0')
  const core = await import(join(consumer, 'node_modules', 'firstmate-dsh', 'lib', 'firstmate-core', 'index.js'))
  assert.equal(typeof core.TaskLedger, 'function')
  assert.equal(typeof core.FirstmateScheduler, 'function')
  const { TYPERT } = await import('firstmate-dsh/typert')
  assert.equal(TYPERT.package, 'firstmate-dsh')
  assert.equal(TYPERT.invocations.length, 6)
  console.log(`Package smoke passed: ${basename(tarball)} packs, installs, and exposes the core API.`)
} finally {
  await rm(root, { recursive: true, force: true })
}
