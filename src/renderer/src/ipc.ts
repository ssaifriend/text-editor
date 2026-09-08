import { R } from '@mobily/ts-belt'
import {
  contracts,
  pushContracts,
  type ErrorOf,
  type InvokeChannel,
  type PushChannel,
  type PushPayload,
  type RequestOf,
  type ValueOf,
} from '@shared/ipc'
import type { IpcResult } from '@shared/result'

const contractViolation = <C extends InvokeChannel>(channel: C, detail: string): ErrorOf<C> =>
  ({ kind: 'unexpected', message: `response for ${channel} violates contract: ${detail}` }) as ErrorOf<C>

export const invoke = async <C extends InvokeChannel>(
  channel: C,
  request: RequestOf<C>,
): Promise<R.Result<ValueOf<C>, ErrorOf<C>>> => {
  const raw = await window.moru.invoke(channel, request)

  const parsed = contracts[channel].response.safeParse(raw)
  if (!parsed.success) return R.Error(contractViolation(channel, parsed.error.message))

  const result = parsed.data as IpcResult<ValueOf<C>, ErrorOf<C>>
  return result.ok ? R.Ok(result.value) : R.Error(result.error)
}

export const on = <C extends PushChannel>(channel: C, handler: (payload: PushPayload<C>) => void): (() => void) =>
  window.moru.on(channel, (raw) => {
    const parsed = pushContracts[channel].safeParse(raw)
    if (parsed.success) handler(parsed.data as PushPayload<C>)
    else console.warn(`push payload on ${channel} violates contract`, parsed.error.message)
  })
