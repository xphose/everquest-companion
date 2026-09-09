// Narrow, attributed patch corrections live apart from the unchanged catalog snapshot.
import type { ClassAbbr } from './classCombo'
import type { GearAcquisition } from './gearAcquisition'
import type { GearRow } from './planner/gear'

export interface GearMechanicsEvidence {
  id: string
  title: string
  text: string
  sourceUrl: string
  effectiveAt: string
  checkedAt: string
}

const CHECKED_AT = '2026-09-09'
const PATCH_ROOT = 'https://www.everquestlegends.com/patch-notes/'

function evidence(id: string, title: string, text: string, patch: string): GearMechanicsEvidence {
  const [month, day, year] = patch.split('-')
  return {
    id, title, text,
    sourceUrl: `${PATCH_ROOT}eql-update-notes-${patch}`,
    effectiveAt: `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`,
    checkedAt: CHECKED_AT
  }
}

const DIFFICULTY = evidence('difficulty', 'Higher difficulty, higher starting item rank',
  'Difficulty 1 can drop +1 or higher items; difficulty 4 can drop +4 or higher. Higher ranks become less likely. This does not state the chance of a particular item.', '7-29-2026')
const CRAWLS = evidence('crawls', 'Dungeon Crawls',
  'Indoor Dungeon Crawls reward clearing every rare enemy and enough original enemies. Kills do not naturally respawn. Completion gives motes and experience, with a possible bonus chest. Easier runs pay less; a run that is too easy may not refund the instance charge.', '9-09-2026')
const MOTES = evidence('motes', 'Save some upgrade resources for spells',
  'Motes require eligibility for kill experience and do not drop at the class lock cap. Void-Touched Potential can raise an item or spell by one full rank and can be earned up to three times weekly through voidling raid activities.', '7-28-2026')
const UNREST = evidence('unrest', 'Unrest item data needs a newer snapshot',
  'Unrest gained new and improved rare-enemy items on August 25. Named enemies are guaranteed without placeholders. The older item catalog does not include all of these changes.', '8-25-2026')
const SOLUSEK = evidence('solusek', 'Solusek’s Eye rare enemies',
  'Rare enemies are guaranteed to spawn without placeholders. This does not give a drop rate for an individual item.', '8-25-2026')
const MISTMOORE = evidence('mistmoore', 'Mistmoore changes',
  'Named enemies are guaranteed and drop a common or rare item with stats. This does not guarantee a specific item. The castle is less aggressive during daytime; nighttime remains more dangerous.', '8-18-2026')
const SKY = evidence('sky', 'Class-specific Plane of Sky quest loot',
  'Bonus personal quest loot rolls separately for active classes, excluding lettered Wind Runes. Bonus items are not guaranteed and obey personal loot filters.', '9-01-2026')
const BROOCHES = evidence('brooch-level', 'Brooch equipment level removed',
  'Rathe Mountains Froglok quest brooch rewards no longer have an equipment level requirement. Quest eligibility is separate.', '9-01-2026')
const MORNING_STAR = evidence('morning-star-class', 'Beastlord equipment added',
  'Enchanted Fine Steel Morning Star is now usable by Beastlords.', '9-01-2026')
const GREATAXE = evidence('greataxe-endurance', 'Endurance changed after the snapshot',
  'Verishe Mal Greataxe gained endurance on August 25. The patch gives no exact amount, so its catalog stats may undervalue it.', '8-25-2026')
const SKARLON = evidence('skarlon-ac', 'Armor changed after the snapshot',
  'Armor drops from Warlord Skarlon gained AC on August 25. The patch gives no exact values, so the older catalog may undervalue these items.', '8-25-2026')
const SPIDER_CAP = evidence('spider-cap', 'Spider Silk Cap upgrading restored',
  'Spider Silk Cap can be upgraded again as of September 9.', '9-09-2026')

/** Curated advisory coverage, not a claim that every patch change has been reconciled. */
export const GEAR_MECHANICS_EVIDENCE: readonly GearMechanicsEvidence[] = [DIFFICULTY, CRAWLS, MOTES]

const BROOCH_KEYS: ReadonlySet<string> = new Set([
  "soldier's brooch of the arcane", "soldier's brooch of the corrupt",
  "soldier's brooch of the darkened", "soldier's brooch of the robust",
  "soldier's brooch of the spirited", "soldier's brooch of the stalwart",
  "soldier's brooch of the stealthy", "soldier's brooch of the virtuous"
])

/** The exact eight catalog brooches are linked to the cited Rathe Mountains quest line. */
export function gearRequiredLevel(row: GearRow): number | undefined {
  return BROOCH_KEYS.has(row.key) ? undefined : row.requiredLevel
}

export function gearClasses(row: GearRow): readonly ClassAbbr[] {
  return row.key === 'enchanted fine steel morning star' && !row.classes.includes('BST')
    ? [...row.classes, 'BST'] : row.classes
}

export function gearKnownPatchNotes(row: GearRow): readonly GearMechanicsEvidence[] {
  if (BROOCH_KEYS.has(row.key)) return [BROOCHES]
  if (row.key === 'enchanted fine steel morning star') return [MORNING_STAR]
  if (row.key === 'verishe mal greataxe') return [GREATAXE]
  if (row.key === 'spider silk cap') return [SPIDER_CAP]
  if (row.key === 'mithril greaves' || row.key === 'mithril vambraces') return [SKARLON]
  return []
}

export function gearAcquisitionNotes(source: GearAcquisition): readonly GearMechanicsEvidence[] {
  const zone = source.zone?.toLowerCase()
  if (zone === 'the estate of unrest' || zone === 'unrest') return [UNREST]
  if (zone === "solusek's eye") return [SOLUSEK]
  if (zone === 'mistmoore castle' || zone === 'castle mistmoore') return [MISTMOORE]
  if (zone === 'plane of sky' || zone === 'the plane of sky') return [SKY]
  return []
}

export function gearCatalogCaveat(scrapedAt: string | null | undefined): string {
  const timestamp = scrapedAt ? Date.parse(scrapedAt) : NaN
  if (!Number.isFinite(timestamp)) return 'Catalog date unknown. Current patch coverage is not verified.'
  const date = new Date(timestamp).toISOString().slice(0, 10)
  return timestamp < Date.parse('2026-09-09T00:00:00Z')
    ? `Catalog snapshot: ${date}. It predates the September 9 patch; cited notes cover selected changes only.`
    : `Catalog snapshot: ${date}. A recent scrape does not verify every current game mechanic.`
}
