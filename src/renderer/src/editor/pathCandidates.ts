import { dirnameOf, resolveFrom } from '@shared/appFile'

const isAbsolute = (path: string): boolean => /^([A-Za-z]:[\\/]|\/)/.test(path)

export const pathCandidates = (ref: string, bufferPath: string | null, projectRoot: string | null, cwd: string | null): string[] => {
  if (isAbsolute(ref) || ref.startsWith('~')) return [ref]
  const bases = [bufferPath ? dirnameOf(bufferPath) : null, projectRoot, cwd].filter((b): b is string => b !== null)
  return [...new Set(bases.map((base) => resolveFrom(base, ref)))]
}
