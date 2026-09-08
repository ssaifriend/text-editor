import { describe, it, expect } from 'vitest'
import { hashBytes } from '../../../src/main/fs/hash'

describe('hashBytes', () => {
  it('is sha256 hex', () => {
    expect(hashBytes(Buffer.from(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(hashBytes(Buffer.from('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})
