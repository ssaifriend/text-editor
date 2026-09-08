import { join } from 'node:path'
import { app, dialog, ipcMain } from 'electron'
import log from 'electron-log/main'
import { z } from 'zod'
import { channels } from '@shared/channels'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LogMessage = z.object({
  level: z.enum(['debug', 'info', 'warn', 'error']),
  message: z.string(),
  meta: z.unknown().optional(),
})

export const initLogging = (userData: string, level: LogLevel): void => {
  log.transports.file.resolvePathFn = () => join(userData, 'logs', 'main.log')
  log.transports.file.maxSize = 5 * 1024 * 1024
  log.transports.file.level = level
  log.transports.console.level = process.env['MORU_TEST'] === '1' ? false : level
}

export const logger = {
  debug: (message: string, meta?: unknown): void => log.debug(message, meta ?? ''),
  info: (message: string, meta?: unknown): void => log.info(message, meta ?? ''),
  warn: (message: string, meta?: unknown): void => log.warn(message, meta ?? ''),
  error: (message: string, meta?: unknown): void => log.error(message, meta ?? ''),
}

export const registerLogChannel = (): void => {
  ipcMain.on(channels.logWrite, (_event, raw: unknown) => {
    const parsed = LogMessage.safeParse(raw)
    if (parsed.success) logger[parsed.data.level](`[renderer] ${parsed.data.message}`, parsed.data.meta)
    else logger.warn('[renderer] malformed log message', raw)
  })
}

export const installCrashHooks = (onRendererGone: () => void): void => {
  process.on('uncaughtException', (error) => {
    logger.error('uncaught exception in main', { message: error.message, stack: error.stack })
    if (process.env['MORU_TEST'] !== '1') dialog.showErrorBox('moru crashed', error.message)
  })

  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled rejection in main', reason)
  })

  app.on('render-process-gone', (_event, _contents, details) => {
    logger.error('renderer process gone', details)
    onRendererGone()
  })
}
