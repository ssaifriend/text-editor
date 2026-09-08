import { describe, it, expect } from 'vitest'
import { defaultSettings, parseSettingsText, resolveForLanguage } from '@shared/config'

describe('parseSettingsText', () => {
  it('returns defaults for an empty object', () => {
    const result = parseSettingsText('{}')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.settings).toEqual(defaultSettings)
  })

  it('accepts comments and trailing commas', () => {
    const result = parseSettingsText(`{
      // tabs are two wide here
      "editor": { "tabSize": 2, },
      /* block */
      "theme": "moru-light",
    }`)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.settings.editor.tabSize).toBe(2)
      expect(result.settings.theme).toBe('moru-light')
      expect(result.settings.editor.fontSize).toBe(defaultSettings.editor.fontSize)
    }
  })

  it('reports a path for a wrong type', () => {
    const result = parseSettingsText('{ "editor": { "tabSize": "four" } }')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('editor.tabSize')
  })

  it('reports syntax errors', () => {
    const result = parseSettingsText('{ "editor": ')
    expect(result.ok).toBe(false)
  })

  it('treats empty text as defaults', () => {
    const result = parseSettingsText('')
    expect(result.ok).toBe(true)
  })
})

describe('resolveForLanguage', () => {
  it('overlays language settings on editor settings', () => {
    const parsed = parseSettingsText('{ "editor": { "wordWrap": false }, "languages": { "markdown": { "wordWrap": true, "tabSize": 2 } } }')
    if (!parsed.ok) throw new Error(parsed.message)

    expect(resolveForLanguage(parsed.settings, 'markdown')).toMatchObject({ wordWrap: true, tabSize: 2 })
    expect(resolveForLanguage(parsed.settings, 'typescript')).toMatchObject({ wordWrap: false, tabSize: defaultSettings.editor.tabSize })
  })
})
