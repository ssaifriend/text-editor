import type { Accessor } from 'solid-js'
import type { CommandRegistry } from '../../commands/registry'
import type { CompiledBinding } from '../../keymap/bindings'
import type { Platform } from '../../keymap/keys'

export type PaletteProps = {
  readonly open: Accessor<boolean>
  readonly onClose: () => void
  readonly registry: CommandRegistry
  readonly bindings: readonly CompiledBinding[]
  readonly platform: Platform
}

export const CommandPalette = (_props: PaletteProps) => null
