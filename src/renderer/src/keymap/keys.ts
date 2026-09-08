import { A, D, O, pipe } from '@mobily/ts-belt'

export type Platform = 'mac' | 'win' | 'linux'

export type KeyStroke = {
  readonly key: string
  readonly ctrl: boolean
  readonly alt: boolean
  readonly shift: boolean
  readonly meta: boolean
}

type Modifier = 'ctrl' | 'alt' | 'shift' | 'meta' | 'mod'

const modifierAliases: Record<string, Modifier> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  option: 'alt',
  shift: 'shift',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
  win: 'meta',
  mod: 'mod',
}

const keyAliases: Record<string, string> = {
  esc: 'escape',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  plus: '+',
  minus: '-',
  return: 'enter',
  del: 'delete',
  pgup: 'pageup',
  pgdn: 'pagedown',
}

const empty: KeyStroke = { key: '', ctrl: false, alt: false, shift: false, meta: false }

const resolveModifier = (part: string, platform: Platform): Exclude<Modifier, 'mod'> => {
  const mod = modifierAliases[part] ?? 'mod'
  return mod === 'mod' ? (platform === 'mac' ? 'meta' : 'ctrl') : mod
}

const parseStroke = (text: string, platform: Platform): KeyStroke => {
  const parts = text.toLowerCase().split('+')
  const keyPart = parts[parts.length - 1] ?? ''
  const key = pipe(D.get(keyAliases, keyPart), O.getWithDefault(keyPart))

  return pipe(
    parts.slice(0, -1),
    A.reduce(empty, (acc, part) => ({ ...acc, [resolveModifier(part, platform)]: true })),
    (s) => ({ ...s, key }),
  )
}

export const parseKeys = (keys: string, platform: Platform): readonly KeyStroke[] =>
  pipe(
    keys.trim().split(/\s+/),
    A.filter((s) => s.length > 0),
    A.map((s) => parseStroke(s, platform)),
  )

const codeToKey: Record<string, string> = {
  Slash: '/',
  Backslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Comma: ',',
  Period: '.',
  Semicolon: ';',
  Quote: "'",
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  Space: 'space',
}

const modifierKeys = ['control', 'shift', 'alt', 'meta', 'os', 'altgraph']

type KeyEventLike = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>

const keyFromCode = (code: string, key: string): string => {
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter) return (letter[1] as string).toLowerCase()
  const digit = /^Digit([0-9])$/.exec(code)
  if (digit) return digit[1] as string
  return codeToKey[code] ?? (key === ' ' ? 'space' : key.toLowerCase())
}

export const strokeFromEvent = (e: KeyEventLike): KeyStroke | null => {
  if (modifierKeys.includes(e.key.toLowerCase())) return null

  return { key: keyFromCode(e.code, e.key), ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey }
}

export const strokeEquals = (a: KeyStroke, b: KeyStroke): boolean =>
  a.key === b.key && a.ctrl === b.ctrl && a.alt === b.alt && a.shift === b.shift && a.meta === b.meta

const namedKeys: Record<string, string> = {
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  space: 'Space',
  escape: 'Esc',
  enter: '↩',
}

const displayKey = (key: string): string => namedKeys[key] ?? key.toUpperCase()

const formatStroke = (s: KeyStroke, platform: Platform): string =>
  platform === 'mac'
    ? `${s.ctrl ? '⌃' : ''}${s.alt ? '⌥' : ''}${s.shift ? '⇧' : ''}${s.meta ? '⌘' : ''}${displayKey(s.key)}`
    : [s.ctrl && 'Ctrl', s.alt && 'Alt', s.shift && 'Shift', s.meta && 'Win', displayKey(s.key)].filter(Boolean).join('+')

export const formatKeys = (strokes: readonly KeyStroke[], platform: Platform): string =>
  strokes.map((s) => formatStroke(s, platform)).join(' ')
