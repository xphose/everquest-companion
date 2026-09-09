import { resolvedClasses, type ComboSnap } from '../../shared/classCombo'
import type { CharacterSnap } from '../../shared/types'
import { parseWornFocus, type WornFocus } from '../../shared/wornFocus'
import { activeCharId, getActiveCharacter } from '../session'
import { effectiveEqRoot } from '../log/config'
import { engineWorldToken } from '../dataServer/engineClientHost'
import { serveModuleSnapshot } from '../dataServer/serveShim'
import { createMacroSpellLoader } from '../macros/spellLoader'
import { readActivePlayer } from '../playerLocation/active'
import { committedFocusLines } from '../planner/wornFocusIndex'
import { currentWornFocus } from '../planner/wornFocusCurrent'
import { readGearProgressionContext, type GearContextDeps } from './context'

let focusCatalog: Record<string, WornFocus> | undefined
function focusByEffect(): Record<string, WornFocus> {
  if (focusCatalog) return focusCatalog
  focusCatalog = {}
  for (const [name, lines] of committedFocusLines()) {
    const focus = parseWornFocus(name, '', lines)
    if (focus) focusCatalog[name] = focus
  }
  return focusCatalog
}
const deps: GearContextDeps = {
  world: () => {
    const character = getActiveCharacter()
    return { characterId: character ? activeCharId() : null, name: character?.name,
      root: effectiveEqRoot(), token: engineWorldToken() }
  },
  livePlayer: readActivePlayer,
  logged: async () => {
    const [combo, character] = await Promise.all([serveModuleSnapshot('combo'), serveModuleSnapshot('character')])
    const current = (combo?.state as ComboSnap | undefined)?.current
    return { classes: current ? resolvedClasses(current) : [], level: (character?.state as CharacterSnap | undefined)?.level?.level }
  },
  spells: createMacroSpellLoader(), now: Date.now,
  focus: () => ({ focusByEffect: focusByEffect(), wornFocus: currentWornFocus() })
}
/** One outstanding context read across views; no second native poller or unbounded spell workers. */
let pending: ReturnType<typeof readGearProgressionContext> | undefined
export function gearProgressionContext(): ReturnType<typeof readGearProgressionContext> {
  pending ??= readGearProgressionContext(deps).finally(() => { pending = undefined })
  return pending
}
