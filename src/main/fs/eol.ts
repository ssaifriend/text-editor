import { A, pipe } from '@mobily/ts-belt'
import { type Eol, eolSequence } from '@shared/encoding'

type Counts = { readonly crlf: number; readonly lf: number; readonly cr: number }

const countEols = (text: string): Counts => {
  const crlf = (text.match(/\r\n/g) ?? []).length
  const lf = (text.match(/\n/g) ?? []).length - crlf
  const cr = (text.match(/\r/g) ?? []).length - crlf
  return { crlf, lf, cr }
}

export const detectEol = (text: string): { eol: Eol; mixed: boolean } => {
  const counts = countEols(text)
  const present = pipe(
    [
      ['crlf', counts.crlf],
      ['lf', counts.lf],
      ['cr', counts.cr],
    ] as const,
    A.filter(([, n]) => n > 0),
  )

  if (present.length === 0) return { eol: 'lf', mixed: false }

  const winner = pipe(
    present,
    A.sortBy(([, n]) => -n),
    A.head,
  )

  return { eol: winner ? winner[0] : 'lf', mixed: present.length > 1 }
}

export const normalizeToLf = (text: string): string => text.replace(/\r\n?/g, '\n')

export const restoreEol = (text: string, eol: Eol): string =>
  eol === 'lf' ? text : text.replace(/\n/g, eolSequence(eol))
