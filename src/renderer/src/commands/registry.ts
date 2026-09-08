import { A, D, pipe } from '@mobily/ts-belt'
import { evaluateWhen, type WhenContext } from './when'

export type Command = {
  readonly id: string
  readonly title: string
  readonly when?: string
  readonly run: (args?: unknown) => void | Promise<void>
}

export type CommandRegistry = {
  readonly register: (command: Command) => void
  readonly registerAll: (commands: readonly Command[]) => void
  readonly get: (id: string) => Command | null
  readonly list: () => readonly Command[]
  readonly available: () => readonly Command[]
  readonly run: (id: string, args?: unknown) => Promise<boolean>
}

export const createCommandRegistry = (getContext: () => WhenContext): CommandRegistry => {
  let commands: Record<string, Command> = {}

  const register = (command: Command): void => {
    commands = D.set(commands, command.id, command)
  }

  const list = (): readonly Command[] => D.values(commands)

  const available = (): readonly Command[] =>
    pipe(
      list(),
      A.filter((c) => evaluateWhen(c.when, getContext())),
    )

  const run = async (id: string, args?: unknown): Promise<boolean> => {
    const command = commands[id]
    if (!command || !evaluateWhen(command.when, getContext())) return false
    await command.run(args)
    return true
  }

  return {
    register,
    registerAll: (all) => all.forEach(register),
    get: (id) => commands[id] ?? null,
    list,
    available,
    run,
  }
}
