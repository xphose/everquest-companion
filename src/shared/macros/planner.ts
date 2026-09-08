import type { MacroPlanInput, MacroRecipe, MacroRole, MacroSelection, MacroSpell, MacroStep, MacroStyle } from '../macros'
import { macroSelectionKey } from '../macros'
import { parseSpellRank, spellLineKey } from '../spellLines'
import { compileMacro, safeMacroText, spellGem } from './compiler'
import { familyChoice, ownedSpells, roleFamilies } from './spells'
import { FAMILY_ROLES } from './utilityRoles'

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
  'summon-item': { name: 'Summon Item', description: 'Cast once, wait for casting and recovery, then stow the summoned cursor item with /autoinventory. Start with an empty cursor and free bag space; check any reagent requirements first.' },
  cure: { name: 'Cure', description: 'Remove the poison, disease or curse counters supported by this spell. Choose a friendly target unless the spell targets yourself or your pet.' },
  root: { name: 'Root Target', description: 'Immobilize your selected enemy. Damage can break root; check the target before casting.' },
  snare: { name: 'Snare Target', description: 'Slow the movement of your selected enemy. Choose the pull deliberately.' },
  lull: { name: 'Lull Target', description: 'Turn melee attack off, then reduce your selected enemy’s reaction range. A resisted lull can still start a fight.' },
  invisibility: { name: 'Invisibility', description: 'Apply this spell’s form of invisibility. Check its creature restrictions; attacks or casting can break it. Choose a friendly target unless it targets yourself or your pet.' },
  vision: { name: 'Vision', description: 'Apply this spell’s see-invisibility or enhanced-vision effect. Choose a friendly target unless it targets yourself or your pet.' },
  breathing: { name: 'Water Breathing', description: 'Apply water breathing. Choose a friendly target unless this spell targets yourself or your pet.' },
  levitation: { name: 'Levitation', description: 'Apply levitation; check the spell’s reagent requirements. Choose a friendly target unless it targets yourself or your pet.' },
  gate: { name: 'Gate', description: 'Cast your self-only Gate spell to return to your bind point. Confirm that you want to leave your current location before pressing it.' },
  rune: { name: 'Rune', description: 'Apply a damage-absorbing rune. Check reagent requirements and choose a friendly target unless this spell targets yourself or your pet.' },
  loc: { name: 'My Location', description: 'Write your current location to the game log.' },
  export: { name: 'Export Gear', description: 'Export your current inventory so the companion can refresh gear ownership.' }
}
const UTILITIES: MacroRole[] = ['cure', 'root', 'snare', 'lull', 'summon-item', 'rune', 'invisibility', 'vision', 'breathing', 'levitation', 'gate']
const PRIORITY: Record<MacroStyle, MacroRole[]> = {
  solo: ['heal-self', 'damage', 'self-buffs', 'buff', 'debuff', 'summon-pet', 'pet-opener', 'heal-pet', 'pet-attack', 'pet-backoff', 'mez', 'heal-target', ...UTILITIES, 'loc', 'export'],
  group: ['heal-target', 'mez', 'debuff', 'self-buffs', 'buff', 'heal-self', 'damage', 'heal-pet', 'pet-backoff', 'summon-pet', 'pet-opener', 'pet-attack', ...UTILITIES, 'loc', 'export'],
  pet: ['summon-pet', 'pet-opener', 'heal-pet', 'pet-backoff', 'debuff', 'self-buffs', 'buff', 'heal-self', 'damage', 'mez', 'heal-target', 'pet-attack', ...UTILITIES, 'loc', 'export']
}
const COMMANDS: Partial<Record<MacroRole, string>> = {
  'pet-attack': '/pet attack', 'pet-backoff': '/pet back off', loc: '/loc', export: '/outputfile inventory'
}

function stepsFor(role: MacroRole, spell: MacroSpell): MacroStep[] {
  const steps: MacroStep[] = []
  if (role === 'pet-opener') steps.push({ kind: 'command', command: '/pet attack' })
  if (['mez', 'lull'].includes(role)) steps.push({ kind: 'command', command: '/attack off' })
  if (role === 'heal-self' && spell.targetType !== 6) steps.push({ kind: 'target-self' })
  if (role === 'heal-pet' && spell.targetType !== 14) steps.push({ kind: 'command', command: '/pet target', pauseTenths: 3 })
  steps.push({ kind: 'cast', spellId: spell.id })
  if (role === 'summon-item') steps.push({ kind: 'command', command: '/autoinventory' })
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
  const chosen = selection ?? { role, spellLine: line }
  return {
    id: macroSelectionKey(chosen), role, ...ROLES[role], selection: chosen,
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
  const steps: MacroStep[] = [{ kind: 'target-self' },
    ...spells.map((spell): MacroStep => ({ kind: 'cast', spellId: spell.id }))]
  return { id: role, role, ...ROLES[role], selection: { role }, ...compileMacro(ROLES[role].name, steps, input),
    description: `${ROLES[role].description} Includes ${spells.map((s) => s.name).join(', ')}.` }
}
function familyRecipes(role: MacroRole, input: MacroPlanInput, choices: MacroSelection[]): MacroRecipe[] {
  const selected = new Map(choices.map((choice) => [choice.spellLine, choice]))
  const families = roleFamilies(input, role)
  const following = choices.some((choice) => choice.spellLine === undefined) ? families[0] : undefined
  for (const family of families) {
    const line = spellLineKey(family[0].name)
    // A role-following choice already represents this default family. Explicit family choices
    // remain in the map, but do not invent a second recommendation for the same active family.
    if (family === following) continue
    selected.set(line, { role, spellLine: line })
  }
  const recipes = [...selected.values()].flatMap((selection) => {
    const recipe = spellRecipe(role, input, selection)
    return recipe ? [recipe] : []
  })
  const labels = new Set<string>()
  return recipes.map((recipe, index) => {
    const spell = input.spells.find((s) => s.id === recipe.requiredSpellIds[0])
    let name = spell ? parseSpellRank(spell.name).base.slice(0, 15) : ROLES[role].name
    if (!safeMacroText(name, 15)) name = `Spell ${index + 1}`
    if (labels.has(name)) name = `${index + 1} ${name}`.slice(0, 15)
    labels.add(name)
    return { ...recipe, name }
  })
}
function recipesForRole(role: MacroRole, input: MacroPlanInput, choices: MacroSelection[]): MacroRecipe[] {
  if (FAMILY_ROLES.includes(role)) return familyRecipes(role, input, choices)
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
