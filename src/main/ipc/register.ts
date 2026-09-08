import { ipcMain, type WebContents } from 'electron'
import { contracts, type InvokeChannel, type RequestOf, type ResponseOf } from '@shared/ipc'
import { err, unexpected } from '@shared/result'

export type HandlerContext = { readonly sender: WebContents }

type Handler<C extends InvokeChannel> = (request: RequestOf<C>, ctx: HandlerContext) => Promise<ResponseOf<C>>

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export const handle = <C extends InvokeChannel>(channel: C, handler: Handler<C>): void => {
  const requestSchema = contracts[channel].request

  ipcMain.handle(channel, async (event, raw: unknown): Promise<ResponseOf<C>> => {
    const parsed = requestSchema.safeParse(raw)
    if (!parsed.success) {
      return err(unexpected(`invalid request on ${channel}: ${parsed.error.message}`)) as ResponseOf<C>
    }

    try {
      return await handler(parsed.data as RequestOf<C>, { sender: event.sender })
    } catch (e) {
      return err(unexpected(messageOf(e))) as ResponseOf<C>
    }
  })
}
