import type { MacroPlanInput, MacroRecipe, MacroRole, MacroSelection, MacroSpell, MacroStep, MacroStyle } from '../macros'
import { macroSelectionKey } from '../macros'
import { parseSpellRank, spellLineKey } from '../spellLines'
import { compileMacro, safeMacroText, spellGem } from './compiler'
import { familyChoice, ownedSpells, roleFamilies } from './spells'

const ROLES: Record<MacroRole, { name: string; description: string }> = {
  damage: { name: 'Single Damage', description: 'Cast on your selected enemy. Single-target spells keep nearby enemies out of the sequence.' },
  'pet-opener': { name: 'Pet Opener', description: 'Send your existing pet at your selected enemy, then cast one single-target damage spell.' },
  'self-buffs': { name: 'Self Buffs', description: 'Target yourself and refresh up to four distinct memorized buff lines. Your target remains yourself afterward.' },
  'heal-self': { name: 'Heal Self', description: 'Target yourself before healing; your target remains yourself afterward.' },
  'heal-target': { name: 'Heal Target', description: 'Heal the friendly target you choose before pressing the social.' },
  'heal-pet': { name: 'Heal Pet', description: 'Target your pet before healing. Use while you have a pet.' },
  buff: { name: 'Refresh Buff', description: 'Refresh one known buff. Choose a friendly target first unless the spell targets yourself or your pet.' },
  debuff: { name: 'Debuff Target', description: 'Debuff your selected enemy before damage. Choose the pull deliberately.' },
  mez: { name: 'Mez Target', description: 'Turn melee attack off before mesmerizing your selected enemy. Existing damage over time and allied attacks can still break mez.' },
  'summon-pet': { name: 'Summon Pet', description: 'Summon a known pet. Check the spell’s reagent requirements and your current pet before pressing it.' },
  'pet-attack': { name: 'Pet Attack', description: 'Send your existing pet at the enemy you selected.' },
  'pet-backoff': { name: 'Pet Back Off', description: 'Ask your pet to stop attacking. Use while you have a pet.' },
  loc: { name: 'My Location', description: 'Write your current location to the game log.' },
  export: { name: 'Export Gear', description: 'Export your current inventory so the companion can refresh gear ownership.' }
}
const PRIORITY: Record<MacroStyle, MacroRole[]> = {
  solo: ['heal-self', 'damage', 'self-buffs', 'buff', 'debuff', 'summon-pet', 'pet-opener', 'heal-pet', 'pet-attack', 'pet-backoff', 'mez', 'heal-target', 'loc', 'export'],
  group: ['heal-target', 'mez', 'debuff', 'self-buffs', 'buff', 'heal-self', 'damage', 'heal-pet', 'pet-backoff', 'summon-pet', 'pet-opener', 'pet-attack', 'loc', 'export'],
  pet: ['summon-pet', 'pet-opener', 'heal-pet', 'pet-backoff', 'debuff', 'self-buffs', 'buff', 'heal-self', 'damage', 'mez', 'heal-target', 'pet-attack', 'loc', 'export']
}
const COMMANDS: Partial<Record<MacroRole, string>> = {
  'pet-attack': '/pet attack', 'pet-backoff': '/pet back off', loc: '/loc', export: '/outputfile inventory'
}

function stepsFor(role: MacroRole, spell: MacroSpell): MacroStep[] {
  const steps: MacroStep[] = []
  if (role === 'pet-opener') steps.push({ kind: 'command', command: '/pet attack' })
  if (role === 'mez') steps.push({ kind: 'command', command: '/attack off' })
  if (role === 'heal-self' && spell.targetType !== 6) steps.push({ kind: 'command', command: '/target myself', pauseTenths: 3 })
  if (role === 'heal-pet' && spell.targetType !== 14) steps.push({ kind: 'command', command: '/pet target', pauseTenths: 3 })
  steps.push({ kind: 'cast', spellId: spell.id })
  return steps
}
function hasPet(input: MacroPlanInput): boolean {
  return ownedSpells(input).some((s) => s.effects.some((effect) => [22, 33, 71].includes(effect.effect)))
}
function commandRecipe(role: MacroRole, input: MacroPlanInput): MacroRecipe | null {
  const command = COMMANDS[role]
  if (!command || (role.startsWith('pet-') && !hasPet(input))) return null
  return { id: role, role, ...ROLES[role], selection: { role }, ...compileMacro(ROLES[role].name, [{ kind: 'command', command }], input) }
}
function unavailableRecipe(selection: MacroSelection, input: MacroPlanInput): MacroRecipe {
  const role = selection.role
  const unavailable = compileMacro(ROLES[role].name, [], input)
  unavailable.reasons = ['The selected spell line is not verified as owned and usable by your current classes and level.']
  return { id: macroSelectionKey(selection), role, ...ROLES[role], selection, ...unavailable }
}
function spellRecipe(role: MacroRole, input: MacroPlanInput, selection?: MacroSelection): MacroRecipe | null {
  if (['pet-opener', 'heal-pet'].includes(role) && !hasPet(input)) return selection ? unavailableRecipe(selection, input) : null
  const families = roleFamilies(input, role === 'pet-opener' ? 'damage' : role)
  const selectedLine = selection?.spellLine
  const family = selectedLine
    ? families.find((line) => spellLineKey(line[0].name) === spellLineKey(selectedLine)) : families[0]
  if (!family) return selection ? unavailableRecipe(selection, input) : null
  const { spell, upgrade } = familyChoice(family, input)
  const line = spellLineKey(spell.name)
  return {
    id: `${role}:${line}`, role, ...ROLES[role], selection: { role, spellLine: line },
    ...compileMacro(ROLES[role].name, stepsFor(role, spell), input),
    description: `${ROLES[role].description} Uses ${spell.name}.`,
    ...(upgrade ? { upgrade: { from: spell, to: upgrade,
      reason: `${upgrade.name} is a higher owned rank in the same spell line. Memorize it to update this recipe.` } } : {})
  }
}

function selfBuffs(input: MacroPlanInput, selected: MacroSelection[]): MacroRecipe | null {
  const spells = roleFamilies(input, 'buff').map((family) => familyChoice(family, input).spell)
    .filter((spell) => [5, 6, 51].includes(spell.targetType) && spellGem(spell.id, input) !== null).slice(0, 4)
  if (spells.length < 2) return selected.length ? unavailableRecipe({ role: 'self-buffs' }, input) : null
  const role = 'self-buffs'
  const steps: MacroStep[] = [{ kind: 'command', command: '/target myself', pauseTenths: 3 },
    ...spells.map((spell): MacroStep => ({ kind: 'cast', spellId: spell.id }))]
  return { id: role, role, ...ROLES[role], selection: { role }, ...compileMacro(ROLES[role].name, steps, input),
    description: `${ROLES[role].description} Includes ${spells.map((s) => s.name).join(', ')}.` }
}
function buffRecipes(input: MacroPlanInput, choices: MacroSelection[]): MacroRecipe[] {
  const selected = new Map(choices.map((choice) => [choice.spellLine, choice]))
  for (const family of roleFamilies(input, 'buff')) {
    const line = spellLineKey(family[0].name)
    selected.set(line, { role: 'buff', spellLine: line })
  }
  const recipes = [...selected.values()].flatMap((selection) => {
    const recipe = spellRecipe('buff', input, selection)
    return recipe ? [recipe] : []
  })
  const labels = new Set<string>()
  return recipes.map((recipe, index) => {
    const spell = input.spells.find((s) => s.id === recipe.requiredSpellIds[0])
    let name = spell ? parseSpellRank(spell.name).base.slice(0, 15) : 'Refresh Buff'
    if (!safeMacroText(name, 15)) name = `Buff ${index + 1}`
    if (labels.has(name)) name = `B${index + 1} ${name}`.slice(0, 15)
    labels.add(name)
    return { ...recipe, name }
  })
}
function recipesForRole(role: MacroRole, input: MacroPlanInput, choices: MacroSelection[]): MacroRecipe[] {
  if (role === 'buff') return buffRecipes(input, choices)
  const special = role === 'self-buffs' ? selfBuffs(input, choices) : commandRecipe(role, input)
  if (special) return [special]
  if (choices.length) return choices.flatMap((choice) => { const recipe = spellRecipe(role, input, choice); return recipe ? [recipe] : [] })
  const recipe = spellRecipe(role, input)
  return recipe ? [recipe] : []
}

/** Recommendations follow playstyle. Explicit selected families never drift into another line;
 * their IDs stay stable across rank upgrades and gem reordering. No selection executes a social. */
export function planMacros(input: MacroPlanInput, selected: MacroSelection[] = []): MacroRecipe[] {
  const out: MacroRecipe[] = []
  for (const role of PRIORITY[input.style]) {
    const choices = selected.filter((s) => s.role === role)
    out.push(...recipesForRole(role, input, choices))
  }
  return out
}
