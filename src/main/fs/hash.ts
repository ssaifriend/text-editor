import { createHash } from 'node:crypto'

export const hashBytes = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')
