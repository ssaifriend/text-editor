import chardet from 'chardet'
import iconv from 'iconv-lite'
import { A, pipe } from '@mobily/ts-belt'
import type { EncodingName } from '@shared/encoding'

export type Confidence = 'high' | 'low'
export type Detected = { readonly encoding: EncodingName; readonly bom: boolean; readonly confidence: Confidence }

const utf8Bom = [0xef, 0xbb, 0xbf]
const strictUtf8 = new TextDecoder('utf-8', { fatal: true })

const startsWith = (bytes: Buffer, prefix: readonly number[]): boolean =>
  prefix.every((b, i) => bytes[i] === b)

const bomOf = (bytes: Buffer): Detected | null => {
  if (startsWith(bytes, utf8Bom)) return { encoding: 'utf8', bom: true, confidence: 'high' }
  if (startsWith(bytes, [0xff, 0xfe])) return { encoding: 'utf16le', bom: true, confidence: 'high' }
  if (startsWith(bytes, [0xfe, 0xff])) return { encoding: 'utf16be', bom: true, confidence: 'high' }
  return null
}

const isValidUtf8 = (bytes: Buffer): boolean => {
  try {
    strictUtf8.decode(bytes)
    return true
  } catch {
    return false
  }
}

const hasHighBit = (bytes: Buffer): boolean => bytes.some((b) => b >= 0x80)

const isHangulSyllable = (cp: number): boolean => cp >= 0xac00 && cp <= 0xd7a3

export const looksLikeCp949 = (bytes: Buffer): boolean => {
  if (!hasHighBit(bytes) || isValidUtf8(bytes)) return false

  const text = iconv.decode(bytes, 'cp949')
  if (text.includes('�')) return false

  const nonAscii = pipe(
    Array.from(text),
    A.filter((ch) => (ch.codePointAt(0) ?? 0) >= 0x80),
  )
  if (nonAscii.length === 0) return false

  const hangul = A.filter(nonAscii, (ch) => isHangulSyllable(ch.codePointAt(0) ?? 0))
  return hangul.length / nonAscii.length >= 0.3
}

const chardetToEncoding: Record<string, EncodingName> = {
  'UTF-8': 'utf8',
  'UTF-16LE': 'utf16le',
  'UTF-16BE': 'utf16be',
  'EUC-KR': 'cp949',
  'ISO-2022-KR': 'cp949',
  Shift_JIS: 'shift_jis',
  GB18030: 'gb18030',
  'ISO-8859-1': 'latin1',
  'windows-1252': 'latin1',
}

const decodesCleanly = (bytes: Buffer, encoding: EncodingName): boolean =>
  !iconv.decode(bytes, encoding).includes('\ufffd')

const latin1Fallback: Detected = { encoding: 'latin1', bom: false, confidence: 'low' }

const fromChardet = (bytes: Buffer): Detected => {
  const best = A.head(chardet.analyse(bytes))
  const mapped = best ? chardetToEncoding[best.name] : undefined

  if (!mapped || mapped === 'utf8' || !decodesCleanly(bytes, mapped)) return latin1Fallback

  return { encoding: mapped, bom: false, confidence: best && best.confidence >= 80 ? 'high' : 'low' }
}

export const detectEncoding = (bytes: Buffer): Detected => {
  if (bytes.length === 0) return { encoding: 'utf8', bom: false, confidence: 'high' }

  const bom = bomOf(bytes)
  if (bom) return bom

  if (isValidUtf8(bytes)) return { encoding: 'utf8', bom: false, confidence: 'high' }

  if (looksLikeCp949(bytes)) return { encoding: 'cp949', bom: false, confidence: 'high' }

  return fromChardet(bytes)
}

export const decodeBytes = (bytes: Buffer, encoding: EncodingName): string => iconv.decode(bytes, encoding)

const differingPositions = (original: string, roundTripped: string): number[] => {
  const a = Array.from(original)
  const b = Array.from(roundTripped)

  return pipe(
    a,
    A.mapWithIndex((i, ch) => (ch === b[i] ? -1 : i)),
    A.filter((i) => i >= 0),
    (xs) => [...xs],
  )
}

export const encodeLossless = (
  text: string,
  encoding: EncodingName,
  bom: boolean,
): { ok: true; bytes: Buffer } | { ok: false; positions: number[] } => {
  const bytes = iconv.encode(text, encoding, { addBOM: bom })
  const roundTripped = iconv.decode(bytes, encoding)

  if (roundTripped === text) return { ok: true, bytes }

  return { ok: false, positions: differingPositions(text, roundTripped) }
}
