import { readFile } from 'node:fs/promises'
import { replaceInLine } from '@shared/replaceText'
import type { ReplacePlan, ReplaceReport, ReplaceSkipReason } from '@shared/search'
import { writeAtomically } from '../fs/atomic'
import { encodeLossless } from '../fs/encoding'
import { restoreEol } from '../fs/eol'
import { hashBytes } from '../fs/hash'
import { readTextFile } from '../fs/read'
import type { ExpectedWrites } from '../watch/expected'

type PlanFile = ReplacePlan['files'][number]
type Changed = ReplaceReport['changed'][number]
type Skipped = ReplaceReport['skipped'][number]
type PreImage = { readonly path: string; readonly before: Buffer; readonly afterHash: string }
type Outcome = { readonly changed?: Changed; readonly skipped?: Skipped; readonly pre?: PreImage }

export type ReplaceService = {
  readonly replace: (plan: ReplacePlan) => Promise<ReplaceReport>
  readonly undoLast: () => Promise<ReplaceReport | null>
}

const skip = (path: string, reason: ReplaceSkipReason): Outcome => ({ skipped: { path, reason } })

const currentHash = async (path: string): Promise<string | null> => {
  try {
    return hashBytes(await readFile(path))
  } catch {
    return null
  }
}

const applyLines = (text: string, plan: ReplacePlan, file: PlanFile): { text: string; matches: number } => {
  const lines = text.split('\n')
  let matches = 0
  for (const { line, skip: excluded } of file.lines) {
    const source = lines[line - 1]
    if (source === undefined) continue
    const result = replaceInLine(source, plan.spec, plan.replacement, plan.preserveCase, excluded)
    if (!result) continue
    lines[line - 1] = result.text
    matches += result.edits.length
  }
  return { text: lines.join('\n'), matches }
}

export const createReplaceService = ({ expected, keep = 5 }: { expected: ExpectedWrites; keep?: number }): ReplaceService => {
  const history: PreImage[][] = []

  const replaceFile = async (plan: ReplacePlan, file: PlanFile): Promise<Outcome> => {
    const opened = await readTextFile(file.path)
    if (!opened.ok) return skip(file.path, /ENOENT/.test(opened.error.message) ? 'notFound' : 'readError')
    if (opened.value.hash !== file.hash) return skip(file.path, 'hashMismatch')

    const { text, matches } = applyLines(opened.value.text, plan, file)
    if (matches === 0) return {}

    const encoded = encodeLossless(restoreEol(text, opened.value.eol), opened.value.encoding, opened.value.bom)
    if (!encoded.ok) return skip(file.path, 'encodingLossy')

    const afterHash = hashBytes(encoded.bytes)
    try {
      const before = await readFile(file.path)
      expected.record(file.path, afterHash)
      await writeAtomically(file.path, encoded.bytes)
      return { changed: { path: file.path, matches }, pre: { path: file.path, before, afterHash } }
    } catch {
      return skip(file.path, 'writeError')
    }
  }

  const replace = async (plan: ReplacePlan): Promise<ReplaceReport> => {
    const outcomes = await Promise.all(plan.files.map((f) => replaceFile(plan, f)))

    const pre = outcomes.flatMap((o) => (o.pre ? [o.pre] : []))
    if (pre.length > 0) {
      history.push(pre)
      if (history.length > keep) history.shift()
    }

    return {
      changed: outcomes.flatMap((o) => (o.changed ? [o.changed] : [])),
      skipped: outcomes.flatMap((o) => (o.skipped ? [o.skipped] : [])),
    }
  }

  const restore = async (pre: PreImage): Promise<Outcome> => {
    if ((await currentHash(pre.path)) !== pre.afterHash) return skip(pre.path, 'hashMismatch')
    try {
      expected.record(pre.path, hashBytes(pre.before))
      await writeAtomically(pre.path, pre.before)
      return { changed: { path: pre.path, matches: 1 } }
    } catch {
      return skip(pre.path, 'writeError')
    }
  }

  const undoLast = async (): Promise<ReplaceReport | null> => {
    const op = history.pop()
    if (!op) return null
    const outcomes = await Promise.all(op.map(restore))
    return {
      changed: outcomes.flatMap((o) => (o.changed ? [o.changed] : [])),
      skipped: outcomes.flatMap((o) => (o.skipped ? [o.skipped] : [])),
    }
  }

  return { replace, undoLast }
}
