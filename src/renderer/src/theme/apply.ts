import { Compartment } from '@codemirror/state'
import type { Theme } from './themes'

export const themeCompartment = new Compartment()

export const applyTheme = (theme: Theme, root: HTMLElement = document.documentElement): void => {
  Object.entries(theme.vars).forEach(([name, value]) => root.style.setProperty(name, value))
  root.dataset['theme'] = theme.id
}
