import { describe, it, expect, vi, beforeEach } from 'vitest'
import { R } from '@mobily/ts-belt'
import { invoke, on } from '@renderer/ipc'
import { defaultSettings } from '@shared/config'

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

describe('renderer on', () => {
  it('registers through the bridge and forwards parsed payloads', () => {
    const listeners: Array<(p: unknown) => void> = []
    const bridgeOn = vi.fn((_c: string, l: (p: unknown) => void) => {
      listeners.push(l)
      return () => undefined
    })
    ;(globalThis as { window?: unknown }).window = { moru: { ...bridge, on: bridgeOn } }

    const handler = vi.fn()
    on('config.changed', handler)
    listeners[0]!({ settings: defaultSettings, error: null })
    listeners[0]!({ malformed: true })

    expect(bridgeOn).toHaveBeenCalledWith('config.changed', expect.any(Function))
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith({ settings: defaultSettings, error: null })
  })
})
