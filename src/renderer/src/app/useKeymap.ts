import type { CommandRegistry } from '../commands/registry'
import { evaluateWhen, type WhenContext } from '../commands/when'
import { type CompiledBinding, resolveStroke } from '../keymap/bindings'
import { type KeyStroke, strokeFromEvent } from '../keymap/keys'

const terminalAllowedPrefixes = ['palette.', 'tab.', 'view.', 'terminal.']
const findAllowedPrefixes = ['palette.', 'tab.', 'view.', 'find.']

export const allowedInTerminal = (commandId: string): boolean =>
  commandId === 'file.new' || terminalAllowedPrefixes.some((prefix) => commandId.startsWith(prefix))

export const allowedInFind = (commandId: string): boolean => findAllowedPrefixes.some((prefix) => commandId.startsWith(prefix))

export const installKeymap = (
  target: Window,
  bindings: () => readonly CompiledBinding[],
  registry: CommandRegistry,
  getContext: () => WhenContext,
): (() => void) => {
  let pending: readonly KeyStroke[] = []

  const handler = (event: KeyboardEvent): void => {
    const ctx = getContext()
    if (ctx['paletteOpen'] === true) return

    const stroke = strokeFromEvent(event)
    if (!stroke) return

    if (stroke.key === 'escape' && pending.length > 0) {
      pending = []
      event.preventDefault()
      return
    }

    const resolution = resolveStroke(bindings(), pending, stroke, (when) => evaluateWhen(when, ctx))

    if (resolution.kind === 'run' && ctx['terminalFocus'] === true && !allowedInTerminal(resolution.binding.command)) {
      pending = []
      return
    }

    if (resolution.kind === 'run' && ctx['findFocus'] === true && !allowedInFind(resolution.binding.command)) {
      pending = []
      return
    }

    if (resolution.kind === 'run') {
      event.preventDefault()
      event.stopPropagation()
      pending = []
      void registry.run(resolution.binding.command, resolution.binding.args)
    } else if (resolution.kind === 'pending') {
      event.preventDefault()
      event.stopPropagation()
      pending = [...pending, stroke]
    } else {
      pending = []
    }
  }

  target.addEventListener('keydown', handler, { capture: true })
  return () => target.removeEventListener('keydown', handler, { capture: true })
}
