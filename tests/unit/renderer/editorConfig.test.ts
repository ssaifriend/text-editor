import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { indentUnit } from '@codemirror/language'
import { defaultSettings } from '@shared/config'
import { configExtensions, settingsCompartment } from '@renderer/editor/editorConfig'

const stateWith = (overrides: Partial<typeof defaultSettings.editor>) =>
  EditorState.create({ extensions: settingsCompartment.of(configExtensions({ ...defaultSettings.editor, ...overrides })) })

describe('configExtensions', () => {
  it('applies tab size and indent unit from settings', () => {
    const spaces = stateWith({ tabSize: 2, insertSpaces: true })
    expect(spaces.facet(EditorState.tabSize)).toBe(2)
    expect(spaces.facet(indentUnit)).toBe('  ')

    const tabs = stateWith({ tabSize: 8, insertSpaces: false })
    expect(tabs.facet(EditorState.tabSize)).toBe(8)
    expect(tabs.facet(indentUnit)).toBe('\t')
  })

  it('can be reconfigured in place without touching the doc', () => {
    const state = EditorState.create({ doc: 'x', extensions: settingsCompartment.of(configExtensions(defaultSettings.editor)) })
    const next = state.update({ effects: settingsCompartment.reconfigure(configExtensions({ ...defaultSettings.editor, tabSize: 3 })) }).state
    expect(next.facet(EditorState.tabSize)).toBe(3)
    expect(next.doc.toString()).toBe('x')
  })
})
