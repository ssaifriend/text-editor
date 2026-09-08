import { createReadStream, realpathSync, statSync } from 'node:fs'
import { extname, sep } from 'node:path'
import { Readable } from 'node:stream'
import { app, protocol } from 'electron'
import { pathFromAppFileUrl } from '@shared/appFile'

export const APP_FILE_SCHEME = 'app-file'

const mimeTypes: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
}

export type Resolved = { ok: true; path: string; mime: string } | { ok: false; status: 403 | 404 }

const fold = (path: string): string => (process.platform === 'win32' ? path.toLowerCase() : path)

export const resolveAppFile = (url: string, root: string | null): Resolved => {
  const requested = pathFromAppFileUrl(url)
  if (!requested || !root) return { ok: false, status: 403 }

  const mime = mimeTypes[extname(requested).toLowerCase()]
  if (!mime) return { ok: false, status: 403 }

  let realRoot: string
  let realPath: string
  try {
    realRoot = realpathSync.native(root)
    realPath = realpathSync.native(requested)
  } catch {
    return { ok: false, status: 404 }
  }
  if (!fold(realPath).startsWith(`${fold(realRoot)}${sep}`)) return { ok: false, status: 403 }
  if (!statSync(realPath).isFile()) return { ok: false, status: 404 }
  return { ok: true, path: realPath, mime }
}

export const registerAppFileScheme = (): void => {
  protocol.registerSchemesAsPrivileged([{ scheme: APP_FILE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }])
}

export const installAppFileProtocol = (deps: { root: () => string | null; log: (message: string) => void }): void => {
  if (!app.isReady()) throw new Error('installAppFileProtocol must run after app ready')
  protocol.handle(APP_FILE_SCHEME, (request) => {
    const resolved = resolveAppFile(request.url, deps.root())
    if (!resolved.ok) {
      deps.log(`app-file refused ${resolved.status}: ${request.url}`)
      return new Response(null, { status: resolved.status })
    }
    return new Response(Readable.toWeb(createReadStream(resolved.path)) as ReadableStream, {
      headers: { 'content-type': resolved.mime, 'cache-control': 'no-cache' },
    })
  })
}
