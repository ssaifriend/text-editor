import { describe, it, expect } from 'vitest'
import { editorContextMenu } from '../../../src/main/menu/context'

const base = { kind: 'editor' as const, hasSelection: false, languageId: 'typescript', path: '/p/a.ts', hasTerminal: false }
const labels = (items: ReturnType<typeof editorContextMenu>) => items.map((i) => i.label ?? i.role ?? i.type)

describe('editorContextMenu', () => {
  it('always offers clipboard, find and edit actions; cut/copy follow the selection', () => {
    const items = editorContextMenu(base, () => undefined)
    expect(labels(items)).toEqual(['cut', 'copy', 'paste', 'Select All', 'separator', 'Find…', 'Replace…', 'Find in Files…', 'separator', 'Toggle Comment', 'Goto Symbol…', 'separator', 'Copy File Path', 'Reveal in Sidebar'])
    expect(items[0]?.enabled).toBe(false)
    expect(editorContextMenu({ ...base, hasSelection: true }, () => undefined)[0]?.enabled).toBe(true)
  })

  it('adds markdown preview, terminal items and hides path items for untitled buffers', () => {
    const ran: string[] = []
    const items = editorContextMenu({ ...base, languageId: 'markdown', hasTerminal: true, path: null, hasSelection: true }, (id) => ran.push(id))
    const names = labels(items)
    expect(names).toContain('Toggle Markdown Preview')
    expect(names).toContain('Send Selection to Terminal')
    expect(names).not.toContain('Copy File Path')
    const sendPath = items.find((i) => i.label === 'Send Path to Terminal')!
    expect(sendPath.enabled).toBe(false)
    ;(items.find((i) => i.label === 'Select All')!.click as () => void)()
    expect(ran).toEqual(['editor.selectAll'])
  })
})
