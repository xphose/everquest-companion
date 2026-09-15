/** Case and spaces only: punctuation and item variants remain distinct. */
export function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/gu, ' ')
}

export function observedTaskId(name: string): string {
  return `task:${nameKey(name)}`
}
