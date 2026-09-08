import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { detectEol, normalizeToLf, restoreEol } from '../../../src/main/fs/eol'

describe('detectEol', () => {
  it('detects lf', () => {
    expect(detectEol('a\nb\nc')).toEqual({ eol: 'lf', mixed: false })
  })

  it('detects crlf', () => {
    expect(detectEol('a\r\nb\r\n')).toEqual({ eol: 'crlf', mixed: false })
  })

  it('detects cr', () => {
    expect(detectEol('a\rb\r')).toEqual({ eol: 'cr', mixed: false })
  })

  it('picks the majority and flags mixed', () => {
    expect(detectEol('a\r\nb\r\nc\nd')).toEqual({ eol: 'crlf', mixed: true })
    expect(detectEol('a\nb\nc\r\nd')).toEqual({ eol: 'lf', mixed: true })
  })

  it('defaults to lf when there are no line endings', () => {
    expect(detectEol('single line')).toEqual({ eol: 'lf', mixed: false })
    expect(detectEol('')).toEqual({ eol: 'lf', mixed: false })
  })
})

describe('normalizeToLf', () => {
  it('turns crlf and lone cr into lf', () => {
    expect(normalizeToLf('a\r\nb\rc\nd')).toBe('a\nb\nc\nd')
  })
})

describe('restoreEol', () => {
  it('rewrites lf to the requested sequence', () => {
    expect(restoreEol('a\nb\n', 'crlf')).toBe('a\r\nb\r\n')
    expect(restoreEol('a\nb\n', 'cr')).toBe('a\rb\r')
    expect(restoreEol('a\nb\n', 'lf')).toBe('a\nb\n')
  })

  it('round-trips with normalizeToLf for any text without carriage returns', () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !s.includes('\r')),
        fc.constantFrom('lf', 'crlf', 'cr'),
        (text, eol) => normalizeToLf(restoreEol(text, eol)) === text,
      ),
    )
  })
})
