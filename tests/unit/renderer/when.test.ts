import { describe, it, expect } from 'vitest'
import { evaluateWhen } from '@renderer/commands/when'

const ctx = { editorFocus: true, terminalFocus: false, hasSelection: false, languageId: 'markdown' }

describe('evaluateWhen', () => {
  it('is true for no expression', () => {
    expect(evaluateWhen(undefined, ctx)).toBe(true)
    expect(evaluateWhen('', ctx)).toBe(true)
    expect(evaluateWhen('   ', ctx)).toBe(true)
  })

  it('reads booleans and treats missing keys as false', () => {
    expect(evaluateWhen('editorFocus', ctx)).toBe(true)
    expect(evaluateWhen('terminalFocus', ctx)).toBe(false)
    expect(evaluateWhen('nope', ctx)).toBe(false)
  })

  it('treats a non-empty string as truthy', () => {
    expect(evaluateWhen('languageId', ctx)).toBe(true)
    expect(evaluateWhen('languageId', { languageId: '' })).toBe(false)
  })

  it('supports negation, and, or with precedence', () => {
    expect(evaluateWhen('!terminalFocus', ctx)).toBe(true)
    expect(evaluateWhen('editorFocus && hasSelection', ctx)).toBe(false)
    expect(evaluateWhen('editorFocus || hasSelection', ctx)).toBe(true)
    expect(evaluateWhen('hasSelection || editorFocus && !terminalFocus', ctx)).toBe(true)
    expect(evaluateWhen('(hasSelection || editorFocus) && terminalFocus', ctx)).toBe(false)
  })

  it('compares against string literals', () => {
    expect(evaluateWhen("languageId == 'markdown'", ctx)).toBe(true)
    expect(evaluateWhen("languageId != 'markdown'", ctx)).toBe(false)
    expect(evaluateWhen("editorFocus && languageId == 'python'", ctx)).toBe(false)
  })

  it('returns false for malformed expressions instead of throwing', () => {
    expect(evaluateWhen('editorFocus &&', ctx)).toBe(false)
    expect(evaluateWhen('(editorFocus', ctx)).toBe(false)
    expect(evaluateWhen("languageId == 'unterminated", ctx)).toBe(false)
  })
})
