import { describe, it, expect } from 'vitest'
import { extensionOf, languageFor } from '@renderer/editor/lang'

describe('extensionOf', () => {
  it('returns the lowercase extension', () => {
    expect(extensionOf('/a/b/File.TS')).toBe('ts')
    expect(extensionOf('notes.md')).toBe('md')
  })

  it('returns the whole name when there is no dot', () => {
    expect(extensionOf('Makefile')).toBe('makefile')
  })
})

describe('languageFor', () => {
  it('returns a non-empty extension for known languages', () => {
    for (const path of ['a.ts', 'a.tsx', 'a.js', 'a.json', 'a.md']) {
      const ext = languageFor(path)
      expect(Array.isArray(ext) && ext.length === 0).toBe(false)
    }
  })

  it('returns an empty extension for unknown languages', () => {
    expect(languageFor('a.unknownext')).toEqual([])
  })
})
