import { describe, it, expect } from 'vitest'
import { contracts } from '@shared/ipc'
import { channelList, sendChannels } from '@shared/channels'

describe('ipc contracts', () => {
  it('every invoke channel has a contract and every contract is an allowed channel', () => {
    const contractChannels = Object.keys(contracts).sort()
    const invokeChannels = channelList.filter((c) => !sendChannels.includes(c)).sort()
    expect(contractChannels).toEqual(invokeChannels)
  })

  it('fs.open response accepts ok and error shapes', () => {
    const schema = contracts['fs.open'].response
    expect(schema.safeParse({ ok: true, value: { path: '/a.ts', text: 'x' } }).success).toBe(true)
    expect(schema.safeParse({ ok: false, error: { kind: 'io', message: 'ENOENT' } }).success).toBe(true)
    expect(schema.safeParse({ ok: false, error: { kind: 'unexpected', message: 'bug' } }).success).toBe(true)
  })

  it('fs.open response rejects malformed payloads', () => {
    const schema = contracts['fs.open'].response
    expect(schema.safeParse({ ok: true, value: { path: '/a.ts' } }).success).toBe(false)
    expect(schema.safeParse({ ok: false, error: { kind: 'weird' } }).success).toBe(false)
    expect(schema.safeParse({ value: 'no ok flag' }).success).toBe(false)
  })

  it('fs.save request requires path and text', () => {
    const schema = contracts['fs.save'].request
    expect(schema.safeParse({ path: '/a.ts', text: '' }).success).toBe(true)
    expect(schema.safeParse({ path: '/a.ts' }).success).toBe(false)
  })

  it('app.bootstrap response carries nullable path and test flag', () => {
    const schema = contracts['app.bootstrap'].response
    expect(schema.safeParse({ ok: true, value: { path: null, test: true } }).success).toBe(true)
    expect(schema.safeParse({ ok: true, value: { path: '/x.md', test: false } }).success).toBe(true)
  })
})
