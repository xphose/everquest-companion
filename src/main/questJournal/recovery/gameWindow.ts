export interface GameWindowSource<T> { id: string; name: string; thumbnail: T }
export interface GameWindowReader<T> {
  readSources: () => Promise<readonly GameWindowSource<T>[]>
  isEmpty: (thumbnail: T) => boolean
  wait: (milliseconds: number) => Promise<void>
}

export function isEverQuestWindow(name: string): boolean {
  return /^(?:EverQuest(?: Legends)?)(?:$|\s*[-–:]\s*.+$)/i.test(name.trim()) && !/companion/i.test(name)
}

/** Windows can temporarily omit a live game from desktopCapturer's enumeration. Retry the fresh
 * window-only read, retaining the first observed identity so an empty image never changes targets. */
export async function acquireGameWindow<T>(reader: GameWindowReader<T>): Promise<T> {
  let selectedId: string | undefined
  for (let attempt = 0; attempt < 3; attempt++) {
    let sources: readonly GameWindowSource<T>[] = []
    try { sources = await reader.readSources() }
    catch { /* A transient capture-call failure has the same bounded retry as a missing window. */ }
    const matches = sources.filter((source) => source.id.startsWith('window:') && isEverQuestWindow(source.name))
    if (matches.length > 1) throw new Error('More than one EverQuest window is open. Choose a screenshot of the intended character’s journal.')
    const found = matches[0]
    if (found) {
      if (selectedId !== undefined && selectedId !== found.id) throw new Error('The EverQuest window changed during capture. Retry or choose a screenshot of the intended character’s journal.')
      selectedId = found.id
      if (!reader.isEmpty(found.thumbnail)) return found.thumbnail
    }
    if (attempt < 2) await reader.wait(350)
  }
  throw new Error('EverQuest may be temporarily unavailable to capture or minimized. Restore its quest journal and retry, or choose a screenshot.')
}
