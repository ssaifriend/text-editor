export type IpcOk<T> = { readonly ok: true; readonly value: T }
export type IpcErr<E> = { readonly ok: false; readonly error: E }
export type IpcResult<T, E> = IpcOk<T> | IpcErr<E>

export const ok = <T>(value: T): IpcOk<T> => ({ ok: true, value })

export const err = <E>(error: E): IpcErr<E> => ({ ok: false, error })

export type UnexpectedError = { readonly kind: 'unexpected'; readonly message: string }

export const unexpected = (message: string): UnexpectedError => ({ kind: 'unexpected', message })
