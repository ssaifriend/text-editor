export const encodingNames = ['utf8', 'utf16le', 'utf16be', 'cp949', 'shift_jis', 'gb18030', 'latin1'] as const
export type EncodingName = (typeof encodingNames)[number]

const labels: Record<EncodingName, string> = {
  utf8: 'UTF-8',
  utf16le: 'UTF-16 LE',
  utf16be: 'UTF-16 BE',
  cp949: 'CP949',
  shift_jis: 'Shift_JIS',
  gb18030: 'GB18030',
  latin1: 'Latin-1',
}

export const encodingLabel = (name: EncodingName, bom: boolean): string =>
  bom ? `${labels[name]} BOM` : labels[name]

export const eolNames = ['lf', 'crlf', 'cr'] as const
export type Eol = (typeof eolNames)[number]

const eolSequences: Record<Eol, string> = { lf: '\n', crlf: '\r\n', cr: '\r' }

export const eolSequence = (eol: Eol): string => eolSequences[eol]

export const eolLabel = (eol: Eol): string => eol.toUpperCase()
