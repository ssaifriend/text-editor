import { describe, it, expect } from 'vitest'
import { parseKeymapText } from '@shared/keymapFile'

describe('parseKeymapText', () => {
  it('parses an array of bindings with comments', () => {
    const r = parseKeymapText(`[
      // split with a spare key
      { "keys": "mod+shift+9", "command": "view.splitRight" },
      { "keys": "mod+k mod+u", "command": "tab.select", "args": 2, "when": "editorFocus" },
    ]`)
    expect(r.ok).toBe(true)
    if (r.ok)
      expect(r.bindings).toEqual([
        { keys: 'mod+shift+9', command: 'view.splitRight' },
        { keys: 'mod+k mod+u', command: 'tab.select', args: 2, when: 'editorFocus' },
      ])
  })

  it('treats empty text as no bindings', () => {
    expect(parseKeymapText('')).toEqual({ ok: true, bindings: [] })
  })

  it('reports schema and syntax errors', () => {
    expect(parseKeymapText('[{ "keys": "" }]').ok).toBe(false)
    expect(parseKeymapText('[ oops').ok).toBe(false)
    expect(parseKeymapText('{ "keys": "a", "command": "b" }').ok).toBe(false)
  })
})
