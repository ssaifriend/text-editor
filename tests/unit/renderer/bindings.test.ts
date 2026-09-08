import { describe, it, expect } from 'vitest'
import { compileBindings, findConflicts, resolveStroke } from '@renderer/keymap/bindings'
import { defaultBindings } from '@renderer/keymap/defaults'
import { parseKeys } from '@renderer/keymap/keys'

const stroke = (keys: string) => parseKeys(keys, 'mac')[0]!
const always = () => true

describe('resolveStroke', () => {
  const compiled = compileBindings(
    [
      { keys: 'mod+d', command: 'editor.selectNextOccurrence', when: 'editorFocus' },
      { keys: 'mod+k mod+d', command: 'editor.skipOccurrence', when: 'editorFocus' },
      { keys: 'mod+k mod+u', command: 'editor.upper', when: 'editorFocus' },
      { keys: 'mod+shift+p', command: 'palette.commands' },
    ],
    'mac',
  )

  it('runs an exact single-stroke match', () => {
    const r = resolveStroke(compiled, [], stroke('mod+d'), always)
    expect(r).toMatchObject({ kind: 'run', binding: { command: 'editor.selectNextOccurrence' } })
  })

  it('reports pending for a chord prefix and runs on completion', () => {
    const first = resolveStroke(compiled, [], stroke('mod+k'), always)
    expect(first.kind).toBe('pending')
    const second = resolveStroke(compiled, [stroke('mod+k')], stroke('mod+d'), always)
    expect(second).toMatchObject({ kind: 'run', binding: { command: 'editor.skipOccurrence' } })
  })

  it('returns none for unbound keys and broken chords', () => {
    expect(resolveStroke(compiled, [], stroke('mod+9'), always).kind).toBe('none')
    expect(resolveStroke(compiled, [stroke('mod+k')], stroke('mod+9'), always).kind).toBe('none')
  })

  it('honours when', () => {
    const r = resolveStroke(compiled, [], stroke('mod+d'), (when) => when === undefined)
    expect(r.kind).toBe('none')
  })

  it('later bindings override earlier ones for the same chord', () => {
    const overlaid = compileBindings(
      [
        { keys: 'mod+d', command: 'a' },
        { keys: 'mod+d', command: 'b' },
      ],
      'mac',
    )
    expect(resolveStroke(overlaid, [], stroke('mod+d'), always)).toMatchObject({ kind: 'run', binding: { command: 'b' } })
  })
})

describe('findConflicts', () => {
  it('reports same chord and same when bound to different commands', () => {
    const compiled = compileBindings(
      [
        { keys: 'mod+d', command: 'a', when: 'editorFocus' },
        { keys: 'mod+d', command: 'b', when: 'editorFocus' },
        { keys: 'mod+d', command: 'c', when: 'terminalFocus' },
        { keys: 'mod+e', command: 'a' },
        { keys: 'mod+e', command: 'a' },
      ],
      'mac',
    )
    expect(findConflicts(compiled)).toEqual([{ keys: 'mod+d', when: 'editorFocus', commands: ['a', 'b'] }])
  })
})

describe('defaultBindings', () => {
  it.each(['mac', 'win'] as const)('%s defaults have no conflicts and parse', (platform) => {
    const compiled = compileBindings(defaultBindings(platform), platform)
    expect(findConflicts(compiled)).toEqual([])
    expect(compiled.every((b) => b.chord.length >= 1 && b.chord.every((s) => s.key.length > 0))).toBe(true)
  })

  it('binds the Sublime essentials', () => {
    const mac = defaultBindings('mac')
    const find = (command: string) => mac.find((b) => b.command === command)?.keys
    expect(find('palette.commands')).toBe('mod+shift+p')
    expect(find('editor.selectNextOccurrence')).toBe('mod+d')
    expect(find('editor.toggleComment')).toBe('mod+/')
    expect(find('file.save')).toBe('mod+s')
    expect(find('tab.close')).toBe('mod+w')
    expect(find('view.splitRight')).toBe('mod+alt+2')
  })
})
