import { useEffect, useRef, useState } from 'react'
import type { CharacterRef } from '@shared/types'
import { CHECKING_GAME, type GameConnectionStatus } from '../../../shared/gameConnection'
import { GameConnectionSession, type GameConnectionView } from './gameConnectionSession'

/** Only the small badge subscribes. Tabs, overlays and macro safety keep their own authority. */
export function useGameConnection(character: CharacterRef | null): GameConnectionStatus {
  const contextKey = JSON.stringify([character?.name, character?.server, character?.logPath])
  const context = useRef({ contextKey, characterName: character?.name })
  context.current = { contextKey, characterName: character?.name }
  const session = useRef<GameConnectionSession | null>(null)
  const [view, setView] = useState<GameConnectionView>({ contextKey, status: CHECKING_GAME })
  useEffect(() => {
    const reader = new GameConnectionSession(() => window.eq.getPlayerLocation(), setView)
    session.current = reader
    reader.setContext(context.current.contextKey, context.current.characterName)
    const reset = (): void => { reader.invalidate(); reader.tick() }
    const offCharacter = window.eq.onCharacter(reset)
    const offConfig = window.eq.onEqConfigChanged(reset)
    const timer = setInterval(() => reader.tick(), 500)
    reader.tick()
    return () => { reader.dispose(); clearInterval(timer); offCharacter(); offConfig(); session.current = null }
  }, [])
  useEffect(() => {
    session.current?.setContext(contextKey, character?.name)
    session.current?.tick()
  }, [contextKey, character?.name])
  return view.contextKey === contextKey ? view.status : CHECKING_GAME
}
