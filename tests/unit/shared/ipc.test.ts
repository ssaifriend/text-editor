import { describe, it, expect } from 'vitest'
import { contracts, pushContracts } from '@shared/ipc'
import { channelList, pushChannels, sendChannels } from '@shared/channels'

describe('ipc contracts', () => {
  it('every invoke channel has a contract and every contract is an allowed channel', () => {
    const contractChannels = Object.keys(contracts).sort()
    const invokeChannels = channelList.filter((c) => !sendChannels.includes(c)).sort()
    expect(contractChannels).toEqual(invokeChannels)
  })

  it('dialog.confirmClose and command.run have contracts', () => {
    expect(contracts['dialog.confirmClose'].response.safeParse({ ok: true, value: { choice: 'save' } }).success).toBe(true)
    expect(contracts['dialog.confirmClose'].response.safeParse({ ok: true, value: { choice: 'maybe' } }).success).toBe(false)
    expect(pushContracts['command.run'].safeParse({ id: 'file.save' }).success).toBe(true)
    expect(pushContracts['command.run'].safeParse({ id: 'tab.select', args: 2 }).success).toBe(true)
  })

  it('every push channel has a push contract', () => {
    expect(Object.keys(pushContracts).sort()).toEqual([...pushChannels].sort())
  })

  it('fs.open request is an object with path and optional encoding', () => {
    const schema = contracts['fs.open'].request
    expect(schema.safeParse({ path: '/a.ts' }).success).toBe(true)
    expect(schema.safeParse({ path: '/a.ts', encoding: 'cp949' }).success).toBe(true)
    expect(schema.safeParse('/a.ts').success).toBe(false)
  })

  it('fs.open response accepts the full OpenedFile and every error kind', () => {
    const schema = contracts['fs.open'].response
    const file = {
      path: '/a.ts', text: 'x', encoding: 'utf8', bom: false, eol: 'lf', mixedEol: false,
      confidence: 'high', hash: 'abc', mtimeMs: 1, readonly: false, largeFile: false,
    }
    expect(schema.safeParse({ ok: true, value: file }).success).toBe(true)
    expect(schema.safeParse({ ok: false, error: { kind: 'io', message: 'ENOENT' } }).success).toBe(true)
    expect(schema.safeParse({ ok: false, error: { kind: 'binary', message: 'NUL' } }).success).toBe(true)
    expect(schema.safeParse({ ok: false, error: { kind: 'unexpected', message: 'bug' } }).success).toBe(true)
  })

  it('fs.open response rejects malformed payloads', () => {
    const schema = contracts['fs.open'].response
    expect(schema.safeParse({ ok: true, value: { path: '/a.ts', text: 'x' } }).success).toBe(false)
    expect(schema.safeParse({ ok: false, error: { kind: 'weird' } }).success).toBe(false)
  })

  it('fs.save request carries encoding, eol, hash and mode', () => {
    const schema = contracts['fs.save'].request
    const good = { path: '/a.ts', text: '', encoding: 'utf8', bom: false, eol: 'lf', expectedHash: null, mode: 'normal' }
    expect(schema.safeParse(good).success).toBe(true)
    expect(schema.safeParse({ ...good, expectedHash: 'abc', mode: 'overwrite' }).success).toBe(true)
    expect(schema.safeParse({ path: '/a.ts', text: '' }).success).toBe(false)
  })

  it('fs.save response accepts conflict and encodingLossy errors', () => {
    const schema = contracts['fs.save'].response
    expect(schema.safeParse({ ok: true, value: { path: '/a', bytes: 1, hash: 'h', mtimeMs: 1 } }).success).toBe(true)
    expect(schema.safeParse({ ok: false, error: { kind: 'conflict', message: 'changed', diskHash: 'h2' } }).success).toBe(true)
    expect(schema.safeParse({ ok: false, error: { kind: 'encodingLossy', message: 'x', positions: [1, 2] } }).success).toBe(true)
    expect(schema.safeParse({ ok: false, error: { kind: 'readonly', message: 'x' } }).success).toBe(true)
  })

  it('app.bootstrap response carries paths and test flag', () => {
    const schema = contracts['app.bootstrap'].response
    expect(schema.safeParse({ ok: true, value: { paths: [], test: true } }).success).toBe(true)
    expect(schema.safeParse({ ok: true, value: { paths: ['/x.md'], test: false } }).success).toBe(true)
    expect(schema.safeParse({ ok: true, value: { path: null, test: true } }).success).toBe(false)
  })
})
