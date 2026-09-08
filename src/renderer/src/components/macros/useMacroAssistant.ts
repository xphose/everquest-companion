import { useCallback, useEffect, useRef, useState } from 'react'
import type { MacroAssistantMutation, MacroAssistantSettings, MacroExistingSocial } from '@shared/macroAssistant'
import { MacroSession, type MacroSessionState } from './macroSession'

export function useMacroAssistant() {
  const [state, setState] = useState<MacroSessionState>({ snapshot: null, busy: false, error: null })
  const session = useRef<MacroSession | null>(null)
  useEffect(() => {
    const current = new MacroSession(window.eq, setState)
    session.current = current
    const off = window.eq.onCharacter(() => { current.reset(); void current.read() })
    void current.read()
    const timer = setInterval(() => { void current.read() }, 2000)
    return () => { current.dispose(); session.current = null; off(); clearInterval(timer) }
  }, [])
  const characterId = state.snapshot?.characterId
  const mutate = useCallback((action: 'queue' | 'restore' | Partial<MacroAssistantSettings>) => {
    if (!characterId) return
    const mutation: MacroAssistantMutation = typeof action === 'string'
      ? { characterId, action } : { characterId, action: 'configure', settings: action }
    void session.current?.mutate(mutation)
  }, [characterId])
  const targetFile = state.snapshot?.installation.targetFile
  const repair = useCallback((social: MacroExistingSocial) => {
    if (characterId && targetFile && social.repair) void session.current?.mutate({ characterId, action: 'repair', targetFile,
      page: social.page, button: social.button, fingerprint: social.repair.fingerprint, recipeId: social.repair.recipeId })
  }, [characterId, targetFile])
  const refresh = useCallback(() => { void session.current?.read(true) }, [])
  const prepare = useCallback((spellIds: number[], destination: { bar: number; page: number }) => {
    if (characterId) void session.current?.mutate({ characterId, action: 'prepare', spellIds, destination })
  }, [characterId])
  const dismissNotice = useCallback((id: number) => { session.current?.dismissNotice(id) }, [])
  return { ...state, mutate, prepare, repair, refresh, dismissNotice }
}
