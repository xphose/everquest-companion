import { currentPlayerLocation } from '../../shared/currentPlayer'
import { isClassAbbr, type ClassAbbr } from '../../shared/classCombo'
import type { GearProgressionContext } from '../../shared/gearProgressionTypes'
import { eligibleGearSpells, gearLevel } from '../../shared/gearProgressionProfile'
import type { MacroSpell } from '../../shared/macros'
import type { PlayerLocation, PlayerLocationResult } from '../../shared/playerLocation'
import type { WornFocus } from '../../shared/wornFocus'

export interface GearContextWorld { characterId: string | null; name?: string; root: string; token: string }
export interface GearContextDeps {
  world: () => GearContextWorld
  livePlayer: () => Promise<PlayerLocationResult>
  logged: () => Promise<{ classes: ClassAbbr[]; level?: number }>
  spells: (root: string, ids: number[]) => Promise<MacroSpell[]>
  focus: () => { focusByEffect: Record<string, WornFocus>; wornFocus: WornFocus[] }
  now: () => number
}
function matchingWorld(a: GearContextWorld, b: GearContextWorld): boolean {
  return a.characterId === b.characterId && a.name === b.name && a.root === b.root && a.token === b.token
}
function freshClasses(classes: readonly ClassAbbr[] | undefined): ClassAbbr[] | undefined {
  if (!classes?.length || classes.length > 3) return undefined
  if (!classes.every(isClassAbbr) || new Set(classes).size !== classes.length) return undefined
  return [...classes]
}
function empty(world: GearContextWorld, message: string): GearProgressionContext {
  return { characterId: world.characterId, classes: [], source: 'none', message }
}
/** No file mutation or macro-service calls. Every asynchronous seam rechecks the world identity. */
export async function readGearProgressionContext(deps: GearContextDeps): Promise<GearProgressionContext> {
  const world = { ...deps.world() }
  if (!world.characterId || !world.name) return empty(world, 'Choose a character to see personalized gear.')
  const observed = await deps.livePlayer().catch(() => undefined)
  if (!matchingWorld(world, deps.world())) return empty(deps.world(), 'Character changed. Refreshing gear…')
  const live = currentPlayerLocation(observed, world.name, deps.now())
  const fallback = nativeProfile(live) ? { classes: [] } : await deps.logged().catch(() => ({ classes: [] }))
  if (!matchingWorld(world, deps.world())) return empty(deps.world(), 'Character changed. Refreshing gear…')
  const context = profile(world, live, fallback)
  Object.assign(context, deps.focus())
  await loadSpells(context, live, world, deps)
  if (!matchingWorld(world, deps.world())) return empty(deps.world(), 'Character changed. Refreshing gear…')
  if (live && !currentPlayerLocation({ state: 'live', location: live }, world.name, deps.now())) {
    return empty(world, 'The player observation expired. Refreshing gear…')
  }
  return context
}
function profile(world: GearContextWorld, live: PlayerLocation | null, fallback: { classes: ClassAbbr[]; level?: number }): GearProgressionContext {
  const classes = freshClasses(live?.classes) ?? freshClasses(fallback.classes) ?? []
  const level = gearLevel(live?.level) ?? gearLevel(fallback.level)
  const native = nativeProfile(live)
  const source = native ? 'live' : 'log'
  return { characterId: world.characterId, classes, level, source: classes.length || level !== undefined ? source : 'none',
    sampledAt: live?.sampledAt, message: native ? 'Using your current game classes and level.' : 'Some profile details come from the last observed log; they may be out of date.' }
}
function nativeProfile(live: PlayerLocation | null): boolean {
  return Boolean(freshClasses(live?.classes) && gearLevel(live?.level) !== undefined)
}
async function loadSpells(context: GearProgressionContext, live: PlayerLocation | null, world: GearContextWorld, deps: GearContextDeps): Promise<void> {
  if (live?.spellbook === undefined || !freshClasses(live.classes) || context.level === undefined) return
  try {
    const spells = await deps.spells(world.root, live.spellbook)
    // The loader preserves raw owned IDs, including upgraded spells; class eligibility is exact.
    context.spells = eligibleGearSpells({ ...context, spells }, context.classes, context.level)
  } catch {
    context.message += ' The client spellbook is unavailable; spell-specific focus value is withheld.'
  }
}
