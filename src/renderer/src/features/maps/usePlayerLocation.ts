import { useEffect, useState } from 'react'
import type { PlayerLocation, PlayerLocationResult } from '@shared/playerLocation'
import { currentPlayerLocation } from './playerLocationState'

const CONNECTING: PlayerLocationResult = { state: 'unavailable', reason: 'Connecting to EverQuest…' }

export function usePlayerLocation(enabled: boolean, characterName: string | undefined): {
  location: PlayerLocation | null
  result: PlayerLocationResult
} {
  const [sample, setSample] = useState({ result: CONNECTING, characterName })
  const result = sample.characterName === characterName ? sample.result : CONNECTING
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let pending = false
    setSample({ result: CONNECTING, characterName })
    const tick = (): void => {
      setNow(Date.now())
      if (pending) return
      pending = true
      void window.eq.getPlayerLocation().then((next) => {
        if (!cancelled) {
          setSample({ result: next, characterName })
          setNow(Date.now())
        }
      }).catch(() => {
        if (!cancelled) setSample({ result: { state: 'unavailable', reason: 'Location reader unavailable. Retrying…' }, characterName })
      }).finally(() => { pending = false })
    }
    tick()
    const timer = setInterval(tick, 250)
    return () => { cancelled = true; clearInterval(timer) }
  }, [enabled, characterName])
  return { result, location: enabled ? currentPlayerLocation(result, characterName, now) : null }
}
