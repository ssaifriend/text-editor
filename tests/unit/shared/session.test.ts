import { describe, it, expect } from 'vitest'
import { SessionFile, WindowSnapshot } from '@shared/session'

const snapshot = {
  windowId: 'w1',
  projectRoot: '/p',
  sidebar: { open: true, expanded: ['/p/src'] },
  layout: {
    kind: 'split',
    direction: 'row',
    sizes: [0.5, 0.5],
    children: [
      {
        kind: 'leaf',
        active: 0,
        tabs: [
          {
            kind: 'buffer', path: '/p/a.ts', dirtyId: 'w1:b1', format: { encoding: 'utf8', bom: false, eol: 'lf' },
            hash: 'h', docHash: 'd', selection: { anchor: 1, head: 1 }, scrollTop: 0, history: null, languageId: 'typescript',
          },
        ],
      },
      { kind: 'leaf', active: 0, tabs: [{ kind: 'terminal', cwd: '/p', title: 'Terminal 1' }] },
    ],
  },
  activePath: [1],
}

describe('session schemas', () => {
  it('accepts a nested snapshot and rejects unknown tab kinds', () => {
    expect(WindowSnapshot.safeParse(snapshot).success).toBe(true)
    expect(SessionFile.safeParse({ version: 1, cleanExit: false, windows: [{ snapshot, bounds: null }] }).success).toBe(true)
    const bad = { ...snapshot, layout: { kind: 'leaf', active: 0, tabs: [{ kind: 'diff' }] } }
    expect(WindowSnapshot.safeParse(bad).success).toBe(false)
  })
})
