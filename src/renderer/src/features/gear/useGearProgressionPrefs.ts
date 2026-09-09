import { useCallback, useState } from 'react'
import { gearProgressionStorageKey, sanitizeGearProgressionPrefs, type GearProgressionPrefs } from './gearProgressionPrefs'

function read(key: string | null): GearProgressionPrefs {
  try { return sanitizeGearProgressionPrefs(key ? JSON.parse(localStorage.getItem(key) ?? 'null') : null) }
  catch { return sanitizeGearProgressionPrefs(null) }
}

/** The caller remounts on character ID; a pending character read never borrows the previous form. */
export function useGearProgressionPrefs(characterId: string | null): [GearProgressionPrefs, (next: GearProgressionPrefs) => void] {
  const key = gearProgressionStorageKey(characterId)
  const [prefs, setPrefs] = useState(() => read(key))
  const set = useCallback((next: GearProgressionPrefs): void => {
    const safe = sanitizeGearProgressionPrefs(next)
    setPrefs(safe)
    try { if (key) localStorage.setItem(key, JSON.stringify(safe)) }
    catch { /* Planning remains usable when local storage is unavailable. */ }
  }, [key])
  return [prefs, set]
}
