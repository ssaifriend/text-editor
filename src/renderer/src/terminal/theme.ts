import type { ITheme } from '@xterm/xterm'
import type { Theme } from '../theme/themes'

export const xtermTheme = (theme: Theme): ITheme => ({
  background: theme.palette.bg,
  foreground: theme.palette.fg,
  cursor: theme.palette.cursor,
  selectionBackground: theme.palette.selection,
  black: theme.dark ? '#1e2227' : '#24292f',
  red: '#ec5f66',
  green: '#99c794',
  yellow: '#fac863',
  blue: '#6699cc',
  magenta: '#c695c6',
  cyan: '#5fb4b4',
  white: theme.dark ? '#d5dae0' : '#57606a',
  brightBlack: theme.dark ? '#5c6773' : '#8c959f',
  brightRed: '#f97b58',
  brightGreen: '#a9d69a',
  brightYellow: '#f9ae58',
  brightBlue: '#7ea8d8',
  brightMagenta: '#d3a6d3',
  brightCyan: '#7ac4c4',
  brightWhite: theme.dark ? '#ffffff' : '#24292f',
})
