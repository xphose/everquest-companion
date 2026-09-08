import { win32 } from 'node:path'

export function sameExecutable(actual: string, expected: string): boolean {
  const normalize = (path: string): string => win32.normalize(path.replace(/^\\\\\?\\/, '')).toLowerCase()
  return normalize(actual) === normalize(expected)
}
