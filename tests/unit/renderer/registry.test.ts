import { describe, it, expect, vi } from 'vitest'
import { createCommandRegistry } from '@renderer/commands/registry'
import { editorCommands } from '@renderer/editor/commands'

describe('command registry', () => {
  it('registers, lists, and runs commands', async () => {
    const registry = createCommandRegistry(() => ({ editorFocus: true }))
    const run = vi.fn()
    registry.register({ id: 'a.one', title: 'One', run })

    expect(registry.list().map((c) => c.id)).toEqual(['a.one'])
    expect(await registry.run('a.one', { x: 1 })).toBe(true)
    expect(run).toHaveBeenCalledWith({ x: 1 })
  })

  it('refuses unknown ids and commands whose when is false', async () => {
    const registry = createCommandRegistry(() => ({ editorFocus: false }))
    const run = vi.fn()
    registry.register({ id: 'e.x', title: 'X', when: 'editorFocus', run })

    expect(await registry.run('missing')).toBe(false)
    expect(await registry.run('e.x')).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })

  it('available() filters by the current context and re-registration replaces', () => {
    const ctx = { editorFocus: false }
    const registry = createCommandRegistry(() => ctx)
    registry.registerAll([
      { id: 'e.x', title: 'X', when: 'editorFocus', run: () => undefined },
      { id: 'g.y', title: 'Y', run: () => undefined },
      { id: 'g.y', title: 'Y2', run: () => undefined },
    ])

    expect(registry.available().map((c) => c.id)).toEqual(['g.y'])
    expect(registry.get('g.y')?.title).toBe('Y2')
    expect(registry.list()).toHaveLength(2)
  })
})

describe('editor command table', () => {
  it('has unique ids that all start with editor. and callable runs', () => {
    const ids = editorCommands.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => id.startsWith('editor.'))).toBe(true)
    expect(editorCommands.every((c) => typeof c.run === 'function' && c.title.length > 0)).toBe(true)
  })
})
