/** Slot budgets pass through the native protocol, service and real rendered Macros view. */
import type { ElectronApplication, Page } from 'playwright-core'
import type { MacroAssistantMutation, MacroAssistantMutationResult, MacroAssistantSnapshot } from '../../src/shared/macroAssistant'
import type { MacroSelection } from '../../src/shared/macros'
import { check, settle } from './appHarness.mjs'
import { publishMacroPlayer } from './macroFixture.mjs'

interface Bridge {
  getMacroAssistant(): Promise<MacroAssistantSnapshot>
  mutateMacroAssistant(mutation: MacroAssistantMutation): Promise<MacroAssistantMutationResult>
}
async function observe(page: Page, predicate: (state: MacroAssistantSnapshot) => boolean, label: string): Promise<MacroAssistantSnapshot> {
  const state = await settle(() => page.evaluate(() =>
    (window as unknown as { eq: Bridge }).eq.getMacroAssistant()), predicate, { timeoutMs: 20_000 })
  if (!check(label, predicate(state), state.loadout?.message)) throw new Error(label)
  return state
}
async function select(page: Page, characterId: string, selections: MacroSelection[]): Promise<void> {
  const result = await page.evaluate((mutation) =>
    (window as unknown as { eq: Bridge }).eq.mutateMacroAssistant(mutation),
  { characterId, action: 'configure' as const, settings: { selections } })
  if (!result.ok) throw new Error(result.error)
}

const BASE_BOOK = [1001, 2001, 3001, 3002, 4001, 5001]
const EIGHT_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8]
const BASE_GEMS = [...BASE_BOOK, ...Array<null>(12).fill(null)]

async function slotDetection(app: ElectronApplication, page: Page): Promise<void> {
  await observe(page, (s) => s.context.availableSpellSlots === 8 && s.context.emptySpellSlots === 2,
    'unlocked empty gems count as available independently of filled capacity')
  const ninthGem = [1001, 2001, 3001, 3002, 4001, null, null, null, 5001, ...Array<null>(9).fill(null)]
  await publishMacroPlayer(app, { gems: ninthGem })
  await observe(page, (s) => s.context.availableSpellSlots === 8 &&
    s.recipes.some((r) => r.role === 'mez' && !r.ready), 'an occupied locked ninth gem cannot make a macro ready')
  await publishMacroPlayer(app, { unlockedSpellSlots: [...EIGHT_SLOTS, 9] })
  await observe(page, (s) => s.context.availableSpellSlots === 9 &&
    s.recipes.some((r) => r.role === 'mez' && r.ready), 'unlocking the occupied ninth gem updates readiness automatically')
  await publishMacroPlayer(app, { unlockedSpellSlots: undefined })
  await observe(page, (s) => s.context.availableSpellSlots === undefined && s.loadout?.state === 'unavailable' &&
    s.recipes.every((r) => !r.requiredSpellIds.length || !r.ready), 'unknown entitlement never falls back to occupied slots')
  await publishMacroPlayer(app, { gems: BASE_GEMS, unlockedSpellSlots: EIGHT_SLOTS })
}

async function loadoutSuggestions(app: ElectronApplication, page: Page): Promise<void> {
  await publishMacroPlayer(app, { book: [...BASE_BOOK, 1002, 3003, 3004, 3005] })
  const live = await observe(page, (s) => s.context.availableSpellSlots === 8 &&
    s.recipes.some((r) => r.id === 'buff:test focus' && r.status === 'needs-memorizing'), 'an owned unmemorized buff can be planned')
  if (!live.characterId) throw new Error('Expected active fixture character')
  const control = page.locator('[data-testid="macros-select-buff:test focus"]')
  await control.waitFor()
  // The renderer follows the IPC result; wait for that result rather than checkbox's immediate state.
  await control.click()
  await observe(page, (s) => s.settings.selections.some((choice) => choice.spellLine === 'test focus') &&
    s.loadout?.state === 'needs-memorizing' && s.loadout.slots.some((slot) =>
      slot.spellId === 3003 && slot.action === 'memorize' && slot.gem === 7),
  'selecting a missing spell recommends the first unlocked empty gem')
  await page.locator('[data-testid="macros-loadout-expand"]').click()
  const assignment = page.locator('[data-testid="macros-loadout-gem-7"]')
  await assignment.waitFor({ state: 'visible' })
  const visible = await settle(() => assignment.innerText(), (text) => text.includes('Test Focus'), { timeoutMs: 10_000 })
  check('the real view names the spell assigned to gem seven', visible.includes('Test Focus'))
  check('a proposed spell does not expose executable commands before memorization',
    await page.getByRole('button', { name: 'Copy Test Focus commands', exact: true }).isDisabled())
  const choices: MacroSelection[] = [
    { role: 'damage' }, { role: 'pet-opener' }, { role: 'heal-target' }, { role: 'summon-pet' }, { role: 'mez' },
    ...['test armor', 'test strength', 'test focus', 'test agility', 'test endurance'].map((spellLine) => ({ role: 'buff' as const, spellLine }))
  ]
  await select(page, live.characterId, choices)
  const exceeded = await observe(page, (s) => s.loadout?.state === 'over-capacity' && s.loadout.requiredSpellCount === 9 &&
    s.loadout.overflow === 1 && s.loadout.slots.length === 8,
  'ten macros share nine unique spells and report one slot short rather than overfilling eight gems')
  const explanation = exceeded.loadout!.message
  const overflow = await settle(() => page.locator('[data-testid="macros-loadout"]').innerText(),
    (text) => text.includes(explanation), { timeoutMs: 10_000 })
  check('the user sees the capacity shortfall', overflow.includes(explanation))
  await select(page, live.characterId, [])
  await publishMacroPlayer(app, { book: [...BASE_BOOK, 1002], gems: BASE_GEMS, unlockedSpellSlots: EIGHT_SLOTS })
  await observe(page, (s) => s.settings.selections.length === 0 && s.context.knownSpells === 7,
    'the fixture returns to the original macro-install flow')
}

export async function verifyMacroSlots(app: ElectronApplication, page: Page): Promise<void> {
  await slotDetection(app, page)
  await loadoutSuggestions(app, page)
}
