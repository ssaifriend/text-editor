import { z } from 'zod'

const ipcResult = <T extends z.ZodType, E extends z.ZodType>(value: T, error: E) =>
  z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value }),
    z.object({ ok: z.literal(false), error }),
  ])

export const IoError = z.object({ kind: z.literal('io'), message: z.string() })
export const UnexpectedError = z.object({ kind: z.literal('unexpected'), message: z.string() })

export const OpenError = z.discriminatedUnion('kind', [IoError, UnexpectedError])
export type OpenError = z.infer<typeof OpenError>

export const SaveError = OpenError
export type SaveError = OpenError

export const OpenedFile = z.object({ path: z.string(), text: z.string() })
export type OpenedFile = z.infer<typeof OpenedFile>

export const SaveRequest = z.object({ path: z.string(), text: z.string() })
export type SaveRequest = z.infer<typeof SaveRequest>

export const SavedMeta = z.object({ path: z.string(), bytes: z.number().int().nonnegative() })
export type SavedMeta = z.infer<typeof SavedMeta>

export const DialogResult = z.object({ path: z.string().nullable() })
export type DialogResult = z.infer<typeof DialogResult>

export const Bootstrap = z.object({ path: z.string().nullable(), test: z.boolean() })
export type Bootstrap = z.infer<typeof Bootstrap>

export const contracts = {
  'app.bootstrap': { request: z.undefined(), response: ipcResult(Bootstrap, UnexpectedError) },
  'fs.open': { request: z.string(), response: ipcResult(OpenedFile, OpenError) },
  'fs.save': { request: SaveRequest, response: ipcResult(SavedMeta, SaveError) },
  'dialog.openFile': { request: z.undefined(), response: ipcResult(DialogResult, UnexpectedError) },
  'dialog.saveFile': { request: z.string().nullable(), response: ipcResult(DialogResult, UnexpectedError) },
} as const

export type Contracts = typeof contracts
export type InvokeChannel = keyof Contracts
export type RequestOf<C extends InvokeChannel> = z.infer<Contracts[C]['request']>
export type ResponseOf<C extends InvokeChannel> = z.infer<Contracts[C]['response']>
export type ValueOf<C extends InvokeChannel> = Extract<ResponseOf<C>, { ok: true }>['value']
export type ErrorOf<C extends InvokeChannel> = Extract<ResponseOf<C>, { ok: false }>['error']
