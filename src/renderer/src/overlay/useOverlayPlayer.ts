import { useEffect, useState } from 'react'
import type { PlayerLocation } from '../../../shared/playerLocation'
import type { CharacterRef } from '../../../shared/types'
import { LOCATION_MAX_AGE_MS } from '../../../shared/currentPlayer'
import { OverlayPlayerSession, type OverlayPlayerBridge } from './overlayPlayerSession'

interface PlayerBridge extends OverlayPlayerBridge { onCharacter(cb: (character: CharacterRef | null) => void): () => void }

/** Mounted only by overlays displaying live player facts; the main reader shares its worker. */
export function useOverlayPlayer(enabled = true, bridge: PlayerBridge = window.eqOverlay): PlayerLocation | null {
  const [player, setPlayer] = useState<PlayerLocation | null>(null)
  useEffect(() => {
    if (!enabled) return
    let expiry: ReturnType<typeof setTimeout> | undefined
    const session = new OverlayPlayerSession(bridge, (value) => {
      clearTimeout(expiry)
      setPlayer(value)
      if (value) expiry = setTimeout(() => session.expire(), Math.max(1, value.sampledAt + LOCATION_MAX_AGE_MS + 1 - Date.now()))
    })
    const off = bridge.onCharacter((character) => session.setCharacter(character))
    const timer = setInterval(() => { void session.read() }, 1000)
    void session.read()
    return () => { clearInterval(timer); clearTimeout(expiry); off(); session.dispose() }
  }, [enabled, bridge])
  return enabled ? player : null
}
