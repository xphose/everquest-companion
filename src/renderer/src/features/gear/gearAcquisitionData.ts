import type { GearRow } from '@shared/planner/gear'
import type { MobData, QuestData } from '@shared/types'
import {
  buildGearAcquisitionIndex,
  buildQuestRewardIndex,
  type GearAcquisitionIndex
} from '../../../../shared/gearAcquisition'
import { sourceIndex } from '../../lib/itemSources'
import questsJson from '../../data/eqlegends/quests.json'
import mobsJson from '../../data/eqlegends/mobs.json'

const quests = questsJson as unknown as QuestData
const mobs = mobsJson as unknown as MobData
const CACHE = new WeakMap<readonly GearRow[], GearAcquisitionIndex>()
let questRewards: GearAcquisitionIndex | undefined

/** The static data's own dates, never replaced by app startup or a patch advisory date. */
export const GEAR_ACQUISITION_SNAPSHOTS = {
  quests: quests.scrapedAt,
  mobs: mobs.scrapedAt
} as const

/** Each immutable row array is joined once; every consumer shares the existing mob inversion. */
export function gearAcquisitions(rows: readonly GearRow[]): GearAcquisitionIndex {
  let index = CACHE.get(rows)
  if (!index) {
    questRewards ??= buildQuestRewardIndex(quests.quests, mobs.mobs)
    index = buildGearAcquisitionIndex(rows, sourceIndex(), questRewards)
    CACHE.set(rows, index)
  }
  return index
}
