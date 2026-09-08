import { describe, it, expect, vi, beforeEach } from 'vitest'
import { R } from '@mobily/ts-belt'
import { invoke } from '@renderer/ipc'

const bridge = { invoke: vi.fn(), send: vi.fn() }

beforeEach(() => {
  bridge.invoke.mockReset()
  ;(globalThis as { window?: unknown }).window = { moru: bridge }
})

describe('renderer invoke', () => {
  it('returns Ok for a valid ok response', async () => {
    bridge.invoke.mockResolvedValue({ ok: true, value: { path: '/a.ts', text: 'x' } })

    const result = await invoke('fs.open', '/a.ts')

    expect(R.isOk(result)).toBe(true)
    expect(R.getExn(result)).toEqual({ path: '/a.ts', text: 'x' })
    expect(bridge.invoke).toHaveBeenCalledWith('fs.open', '/a.ts')
  })

  it('returns Error for a valid error response', async () => {
    bridge.invoke.mockResolvedValue({ ok: false, error: { kind: 'io', message: 'ENOENT' } })

    const result = await invoke('fs.open', '/missing')

    expect(R.isError(result)).toBe(true)
    R.tapError(result, (e) => expect(e).toEqual({ kind: 'io', message: 'ENOENT' }))
  })

  it('returns unexpected Error when the response does not match the contract', async () => {
    bridge.invoke.mockResolvedValue({ ok: true, value: { nope: 1 } })

    const result = await invoke('fs.open', '/a.ts')

    expect(R.isError(result)).toBe(true)
    R.tapError(result, (e) => expect(e.kind).toBe('unexpected'))
  })
})
