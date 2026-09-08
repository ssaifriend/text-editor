import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { appFileUrl } from '../../../src/shared/appFile'

vi.mock('electron', () => ({ app: { isReady: () => true }, protocol: { handle: vi.fn(), registerSchemesAsPrivileged: vi.fn() } }))

const { resolveAppFile } = await import('../../../src/main/preview/protocol')

const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'moru-appfile-')))
mkdirSync(join(root, 'img'))
writeFileSync(join(root, 'img', 'a.png'), 'x')
writeFileSync(join(root, 'img', 'a.html'), '<b>')
const outside = realpathSync.native(mkdtempSync(join(tmpdir(), 'moru-outside-')))
writeFileSync(join(outside, 'secret.png'), 'y')
symlinkSync(join(outside, 'secret.png'), join(root, 'img', 'link.png'))

describe('resolveAppFile', () => {
  it('serves image files under the root', () => {
    expect(resolveAppFile(appFileUrl(join(root, 'img', 'a.png')), root)).toEqual({ ok: true, path: join(root, 'img', 'a.png'), mime: 'image/png' })
  })

  it('refuses traversal, symlink escapes, missing files, no root and non-image types', () => {
    expect(resolveAppFile(appFileUrl(join(root, '..', 'x.png')), root)).toEqual({ ok: false, status: 404 })
    expect(resolveAppFile(appFileUrl(join(outside, 'secret.png')), root)).toEqual({ ok: false, status: 403 })
    expect(resolveAppFile(appFileUrl(join(root, 'img', 'link.png')), root)).toEqual({ ok: false, status: 403 })
    expect(resolveAppFile(appFileUrl(join(root, 'img', 'nope.png')), root)).toEqual({ ok: false, status: 404 })
    expect(resolveAppFile(appFileUrl(join(root, 'img', 'a.png')), null)).toEqual({ ok: false, status: 403 })
    expect(resolveAppFile(appFileUrl(join(root, 'img', 'a.html')), root)).toEqual({ ok: false, status: 403 })
    expect(resolveAppFile('https://evil/x.png', root)).toEqual({ ok: false, status: 403 })
  })
})
