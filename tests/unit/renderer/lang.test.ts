import { describe, it, expect } from 'vitest'
import { basenameOf, extensionOf, languageById, languageFor, languages, plainLanguage } from '@renderer/editor/lang'

describe('extensionOf / basenameOf', () => {
  it('extracts lowercase extension and basename for posix and windows paths', () => {
    expect(extensionOf('/a/b/File.TS')).toBe('ts')
    expect(extensionOf('C:\\work\\notes.MD')).toBe('md')
    expect(basenameOf('/a/b/File.TS')).toBe('File.TS')
    expect(basenameOf('C:\\work\\notes.MD')).toBe('notes.MD')
    expect(extensionOf('Makefile')).toBe('makefile')
  })
})

describe('languageFor', () => {
  it.each([
    ['a.ts', 'typescript'],
    ['a.tsx', 'tsx'],
    ['a.js', 'javascript'],
    ['a.mjs', 'javascript'],
    ['a.jsx', 'jsx'],
    ['a.json', 'json'],
    ['a.md', 'markdown'],
    ['a.py', 'python'],
    ['a.rs', 'rust'],
    ['a.go', 'go'],
    ['a.html', 'html'],
    ['a.css', 'css'],
    ['a.yml', 'yaml'],
    ['a.yaml', 'yaml'],
    ['a.sql', 'sql'],
    ['a.sh', 'shell'],
    ['a.zsh', 'shell'],
    ['a.bash', 'shell'],
    ['.zshrc', 'shell'],
    ['a.unknownext', 'plain'],
    ['LICENSE', 'plain'],
  ])('%s → %s', (path, id) => {
    expect(languageFor(path).id).toBe(id)
  })

  it('every non-plain language loads a non-empty extension', () => {
    for (const lang of languages.filter((l) => l.id !== 'plain')) {
      const ext = lang.load()
      expect(Array.isArray(ext) && ext.length === 0).toBe(false)
    }
  })
})

describe('languageById', () => {
  it('returns the language or plain', () => {
    expect(languageById('python').name).toBe('Python')
    expect(languageById('nope')).toBe(plainLanguage)
  })
})
