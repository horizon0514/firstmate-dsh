import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ReviewResult } from '../shared/types.ts'

const execFileAsync = promisify(execFile)
const MAX_DIFF_CHARS = 24_000

export interface GitArtifacts {
  readonly files: readonly string[]
  readonly diff?: string
  readonly commit?: string
  readonly risks: readonly string[]
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  })
  return stdout
}

export async function collectGitArtifacts(cwd: string): Promise<GitArtifacts> {
  try {
    await git(cwd, ['rev-parse', '--is-inside-work-tree'])
    const [unstaged, staged, untracked, commit] = await Promise.all([
      git(cwd, ['diff', '--no-ext-diff', '--unified=3']),
      git(cwd, ['diff', '--cached', '--no-ext-diff', '--unified=3']),
      git(cwd, ['ls-files', '--others', '--exclude-standard', '-z']),
      git(cwd, ['rev-parse', 'HEAD']).catch(() => ''),
    ])
    const changed = await git(cwd, ['diff', '--name-only', '-z', 'HEAD']).catch(() => '')
    const files = [...new Set(`${changed}${untracked}`.split('\0').filter(Boolean))].sort()
    const combined = [unstaged.trim(), staged.trim()].filter(Boolean).join('\n\n')
    const truncated = combined.length > MAX_DIFF_CHARS
    return {
      files,
      ...(combined === '' ? {} : {
        diff: truncated
          ? `${combined.slice(0, MAX_DIFF_CHARS)}\n\n[diff truncated by Firstmate]`
          : combined,
      }),
      ...(commit.trim() === '' ? {} : { commit: commit.trim() }),
      risks: truncated ? ['Git diff was truncated in the review package; inspect the workspace for the full diff.'] : [],
    }
  } catch (error: unknown) {
    return {
      files: [],
      risks: [`Git evidence could not be collected: ${error instanceof Error ? error.message : String(error)}`],
    }
  }
}

export function mergeGitArtifacts(result: ReviewResult, artifacts: GitArtifacts): ReviewResult {
  return {
    ...result,
    files: [...new Set([...result.files, ...artifacts.files])].sort(),
    ...(result.diff !== undefined ? {} : artifacts.diff === undefined ? {} : { diff: artifacts.diff }),
    ...(result.commit !== undefined ? {} : artifacts.commit === undefined ? {} : { commit: artifacts.commit }),
    risks: [...result.risks, ...artifacts.risks],
  }
}
