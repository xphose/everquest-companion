/** A leaf fan-out. Engine ownership stays in engineClientHost; windows do not own recording. */
const observers = new Set<() => void>()

export function subscribeJournalObservations(observer: () => void): () => void {
  observers.add(observer)
  return () => { observers.delete(observer) }
}

export function publishJournalObservations(module?: string): void {
  if (module !== undefined && module !== 'tasks' && module !== 'turnins') return
  for (const observer of observers) observer()
}
