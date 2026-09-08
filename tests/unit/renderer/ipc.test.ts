import { describe, it, expect, vi, beforeEach } from 'vitest'
import { R } from '@mobily/ts-belt'
import { invoke } from '@renderer/ipc'

const bridge = { invoke: vi.fn(), send: vi.fn() }

const openedFile = {
  path: '/a.ts', text: 'x', encoding: 'utf8', bom: false, eol: 'lf', mixedEol: false,
  confidence: 'high', hash: 'abc', mtimeMs: 1, readonly: false, largeFile: false,
}

beforeEach(() => {
  bridge.invoke.mockReset()
  ;(globalThis as { window?: unknown }).window = { moru: bridge }
})

describe('renderer invoke', () => {
  it('returns Ok for a valid ok response', async () => {
    bridge.invoke.mockResolvedValue({ ok: true, value: openedFile })

    const result = await invoke('fs.open', { path: '/a.ts' })

    expect(R.isOk(result)).toBe(true)
    expect(R.getExn(result)).toEqual(openedFile)
    expect(bridge.invoke).toHaveBeenCalledWith('fs.open', { path: '/a.ts' })
  })

  it('returns Error for a valid error response', async () => {
    bridge.invoke.mockResolvedValue({ ok: false, error: { kind: 'io', message: 'ENOENT' } })

    const result = await invoke('fs.open', { path: '/missing' })

    expect(R.isError(result)).toBe(true)
    R.tapError(result, (e) => expect(e).toEqual({ kind: 'io', message: 'ENOENT' }))
  })

  it('returns unexpected Error when the response does not match the contract', async () => {
    bridge.invoke.mockResolvedValue({ ok: true, value: { nope: 1 } })

    const result = await invoke('fs.open', { path: '/a.ts' })

    expect(R.isError(result)).toBe(true)
    R.tapError(result, (e) => expect(e.kind).toBe('unexpected'))
  })
})
