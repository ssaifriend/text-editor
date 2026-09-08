import { describe, it, expect } from 'vitest'
import { ok, err, unexpected } from '@shared/result'

describe('IpcResult constructors', () => {
  it('ok wraps a value', () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 })
  })

  it('err wraps an error', () => {
    expect(err({ kind: 'io', message: 'nope' })).toEqual({ ok: false, error: { kind: 'io', message: 'nope' } })
  })

  it('unexpected builds the catch-all error', () => {
    expect(unexpected('boom')).toEqual({ kind: 'unexpected', message: 'boom' })
  })
})
