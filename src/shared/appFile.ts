const isWindowsPath = (path: string): boolean => /^[A-Za-z]:[\\/]/.test(path)

const splitPath = (path: string): string[] => path.split(/[\\/]+/)

export const normalizePath = (path: string): string => {
  const windows = isWindowsPath(path)
  const parts = splitPath(path)
  const out: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (out.length > (windows ? 1 : 0)) out.pop()
      continue
    }
    out.push(part)
  }
  return windows ? out.join('\\') : `/${out.join('/')}`
}

export const dirnameOf = (path: string): string => {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index <= 0 ? (isWindowsPath(path) ? path.slice(0, 3) : '/') : path.slice(0, index)
}

export const resolveFrom = (base: string, relative: string): string => {
  if (relative.startsWith('/') || isWindowsPath(relative)) return normalizePath(relative)
  const separator = isWindowsPath(base) ? '\\' : '/'
  return normalizePath(`${base}${separator}${relative}`)
}

export const isUnder = (path: string, root: string): boolean => {
  const normalizedRoot = normalizePath(root)
  const normalizedPath = normalizePath(path)
  const fold = (p: string): string => (isWindowsPath(p) ? p.toLowerCase() : p)
  const r = fold(normalizedRoot)
  const p = fold(normalizedPath)
  return p === r || p.startsWith(r.endsWith('\\') || r.endsWith('/') ? r : `${r}${isWindowsPath(r) ? '\\' : '/'}`)
}

export const appFileUrl = (absolutePath: string): string => `app-file://local/${encodeURIComponent(normalizePath(absolutePath))}`

export const pathFromAppFileUrl = (url: string): string | null => {
  const m = /^app-file:\/\/local\/(.+)$/.exec(url)
  if (!m) return null
  try {
    return normalizePath(decodeURIComponent(m[1]!))
  } catch {
    return null
  }
}
