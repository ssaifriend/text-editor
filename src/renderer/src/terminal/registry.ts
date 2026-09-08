import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal, type ITheme } from '@xterm/xterm'
import { D } from '@mobily/ts-belt'
import { filePathLinkProvider } from './links'

export type TerminalEntry = { readonly term: Terminal; readonly element: HTMLDivElement; readonly fit: FitAddon }

export type TerminalOptions = { readonly theme: ITheme; readonly fontFamily: string; readonly fontSize: number }

type Deps = {
  readonly onInput: (id: string, data: string) => void
  readonly onResize: (id: string, cols: number, rows: number) => void
  readonly onAck: (id: string, bytes: number) => void
  readonly openPath: (path: string, line?: number, col?: number) => void
  readonly openUrl: (url: string) => void
}

export type TerminalRegistry = {
  readonly create: (id: string, options: TerminalOptions) => TerminalEntry
  readonly get: (id: string) => TerminalEntry | null
  readonly write: (id: string, data: string) => void
  readonly dispose: (id: string) => void
  readonly setTheme: (theme: ITheme) => void
  readonly setFont: (fontFamily: string, fontSize: number) => void
}

const encoder = new TextEncoder()

const tryWebgl = (term: Terminal): void => {
  try {
    const webgl = new WebglAddon()
    webgl.onContextLoss(() => webgl.dispose())
    term.loadAddon(webgl)
  } catch {
    // the DOM renderer stays active when WebGL is unavailable
  }
}

export const createTerminalRegistry = (deps: Deps): TerminalRegistry => {
  let entries: Record<string, TerminalEntry> = {}

  const create = (id: string, options: TerminalOptions): TerminalEntry => {
    const element = document.createElement('div')
    element.className = 'terminal-surface'

    const term = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      convertEol: false,
      scrollback: 10_000,
      fontFamily: options.fontFamily,
      fontSize: options.fontSize,
      theme: options.theme,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new Unicode11Addon())
    term.unicode.activeVersion = '11'
    term.loadAddon(new SearchAddon())
    term.loadAddon(new WebLinksAddon((_event, uri) => deps.openUrl(uri)))
    term.registerLinkProvider(filePathLinkProvider(term, (path, line, col) => deps.openPath(path, line, col)))
    term.open(element)
    tryWebgl(term)

    term.onData((data) => deps.onInput(id, data))
    term.onResize(({ cols, rows }) => deps.onResize(id, cols, rows))

    const entry = { term, element, fit }
    entries = D.set(entries, id, entry)
    return entry
  }

  return {
    create,
    get: (id) => entries[id] ?? null,
    write: (id, data) => {
      const entry = entries[id]
      if (entry) entry.term.write(data, () => deps.onAck(id, encoder.encode(data).length))
    },
    dispose: (id) => {
      const entry = entries[id]
      if (!entry) return
      entry.term.dispose()
      entry.element.remove()
      entries = D.deleteKey(entries, id)
    },
    setTheme: (theme) => Object.values(entries).forEach((e) => (e.term.options.theme = theme)),
    setFont: (fontFamily, fontSize) =>
      Object.values(entries).forEach((e) => {
        e.term.options.fontFamily = fontFamily
        e.term.options.fontSize = fontSize
        e.fit.fit()
      }),
  }
}
