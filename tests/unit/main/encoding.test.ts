import { describe, it, expect } from 'vitest'
import iconv from 'iconv-lite'
import { detectEncoding, decodeBytes, encodeLossless, looksLikeCp949 } from '../../../src/main/fs/encoding'

const korean = '안녕하세요, 세계. 한글 인코딩 테스트 문장입니다.\n두 번째 줄도 있습니다.\n'

describe('detectEncoding', () => {
  it('detects utf8 without BOM as high confidence', () => {
    expect(detectEncoding(Buffer.from(korean, 'utf8'))).toEqual({ encoding: 'utf8', bom: false, confidence: 'high' })
  })

  it('detects utf8 BOM', () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(korean, 'utf8')])
    expect(detectEncoding(bytes)).toEqual({ encoding: 'utf8', bom: true, confidence: 'high' })
  })

  it('detects utf16le and utf16be by BOM', () => {
    expect(detectEncoding(iconv.encode(korean, 'utf16le', { addBOM: true }))).toEqual({ encoding: 'utf16le', bom: true, confidence: 'high' })
    expect(detectEncoding(iconv.encode(korean, 'utf16be', { addBOM: true }))).toEqual({ encoding: 'utf16be', bom: true, confidence: 'high' })
  })

  it('detects cp949 Korean text', () => {
    expect(detectEncoding(iconv.encode(korean, 'cp949'))).toEqual({ encoding: 'cp949', bom: false, confidence: 'high' })
  })

  it('treats pure ASCII as utf8', () => {
    expect(detectEncoding(Buffer.from('plain ascii\n'))).toEqual({ encoding: 'utf8', bom: false, confidence: 'high' })
  })

  it('treats an empty buffer as utf8', () => {
    expect(detectEncoding(Buffer.alloc(0))).toEqual({ encoding: 'utf8', bom: false, confidence: 'high' })
  })

  it('falls back to latin1 with low confidence for a handful of high-bit bytes', () => {
    const detected = detectEncoding(Buffer.from([0x63, 0x61, 0x66, 0xe9]))
    expect(detected.encoding).toBe('latin1')
    expect(detected.confidence).toBe('low')
  })
})

describe('looksLikeCp949', () => {
  it('is true for cp949-encoded Korean', () => {
    expect(looksLikeCp949(iconv.encode(korean, 'cp949'))).toBe(true)
  })

  it('is false for latin1 text with accents', () => {
    expect(looksLikeCp949(iconv.encode('café résumé naïve façade', 'latin1'))).toBe(false)
  })

  it('is false for valid utf8', () => {
    expect(looksLikeCp949(Buffer.from(korean, 'utf8'))).toBe(false)
  })
})

describe('decodeBytes', () => {
  it('strips the BOM for utf8 and utf16', () => {
    const utf8 = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('x', 'utf8')])
    expect(decodeBytes(utf8, 'utf8')).toBe('x')
    expect(decodeBytes(iconv.encode('x', 'utf16le', { addBOM: true }), 'utf16le')).toBe('x')
  })

  it('decodes cp949', () => {
    expect(decodeBytes(iconv.encode(korean, 'cp949'), 'cp949')).toBe(korean)
  })
})

describe('encodeLossless', () => {
  it('round-trips representable text and adds BOM when asked', () => {
    const result = encodeLossless(korean, 'cp949', false)
    expect(result.ok).toBe(true)
    if (result.ok) expect(iconv.decode(result.bytes, 'cp949')).toBe(korean)

    const withBom = encodeLossless('x', 'utf8', true)
    if (withBom.ok) expect([...withBom.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  })

  it('reports positions of characters the encoding cannot represent', () => {
    const result = encodeLossless('한 😀 글 🎉', 'cp949', false)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.positions).toEqual([2, 6])
  })
})
