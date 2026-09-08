import type { TestContext } from 'node:test'
import type { MacroSpell } from '../src/shared/macros.ts'
import type { PlayerLocation } from '../src/shared/playerLocation.ts'
import { DAMAGE, macroFixture, STOPPED } from './macroServiceFixture.mts'
import { worldKey } from '../src/main/macros/settings.ts'

export const FOOD: MacroSpell = { ...DAMAGE, id: 50, name: 'Summon Food', targetType: 6, effects: [{ effect: 32, base: 13005 }] }
export const DRINK: MacroSpell = { ...FOOD, id: 55, name: 'Summon Drink', effects: [{ effect: 32, base: 13006 }] }
export const WOLF: MacroSpell = { ...DAMAGE, id: 93, name: 'Spirit Wolf', classLevels: { SHM: 1 }, targetType: 6, effects: [{ effect: 3, base: 20 }] }
export const HEAL: MacroSpell = { ...DAMAGE, id: 92, name: 'Minor Healing', classLevels: { SHM: 1 }, effects: [{ effect: 0, base: 10 }] }

export async function preparationFixture(t: TestContext) {
  const f = await macroFixture(t)
  const spells = [DAMAGE, WOLF, FOOD, DRINK, HEAL]
  f.deps.spells = async () => structuredClone(spells)
  const observe = (gems: (number | null)[] = [94, 93], patch: Partial<PlayerLocation> = {}): void => {
    const player = f.live()
    if (player.state !== 'live') throw new Error('Expected fixture observation.')
    Object.assign(player.location, { spellbook: spells.map((spell) => spell.id),
      memorizedSpells: [...gems, ...Array<null>(18 - gems.length).fill(null)] }, patch)
    f.setPlayer(player)
  }
  observe()
  const prepare = (spellIds = [50, 55]) => f.service.mutate({ action: 'prepare', characterId: f.world.characterId, spellIds, destination: { bar: 4, page: 2 } })
  const saved = () => f.deps.repository.get(worldKey(f.world))
  const install = async (): Promise<void> => { f.setPlayer(STOPPED); await f.service.tick() }
  return { ...f, observe, prepare, saved, install, spells }
}
