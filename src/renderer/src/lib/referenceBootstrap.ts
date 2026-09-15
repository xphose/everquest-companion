import { installReferenceData } from './referenceData'
const RECOVERY_STYLE = 'color:#e8e9eb;background:#101216;min-height:100vh;padding:24px;box-sizing:border-box;font:16px system-ui'

/** A failed bridge must not silently combine bundled rows with a different main-process pack. */
export async function bootstrapReferenceData(start: () => Promise<unknown>): Promise<void> {
  const root = document.getElementById('root')
  if (!root) throw new Error('Game data loading needs the app container.')
  root.textContent = 'Opening your game data…'
  root.style.cssText = RECOVERY_STYLE
  try {
    const data = await window.eq.getWikiCatalogRendererData()
    installReferenceData(data)
    root.dataset.wikiGeneration = data.generation
    root.removeAttribute('style')
    root.textContent = ''
    await start()
  } catch (cause) {
    root.style.cssText = RECOVERY_STYLE
    root.replaceChildren()
    const message = document.createElement('p')
    message.textContent = 'Companion could not open its game data. Retry to open your saved journal and maps.'
    const retry = document.createElement('button')
    retry.textContent = 'Retry'
    retry.addEventListener('click', () => location.reload())
    root.append(message, retry)
    root.setAttribute('role', 'alert')
    try {
      window.eq?.reportError({ source: 'renderer:gameData', message: cause instanceof Error ? cause.message : String(cause) })
    } catch { /* The recovery action remains available even when preload itself failed. */ }
  }
}
