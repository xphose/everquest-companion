import { activeBuffNameRequest, type ActiveBuffNames } from '../../shared/activeBuffs'
import type { MacroSpell } from '../../shared/macros'

export interface ActiveBuffScope { root: string | null; characterName?: string; characterPath?: string; token: string }
interface MetadataDeps {
  scope(): ActiveBuffScope
  spells(root: string, ids: number[]): Promise<MacroSpell[]>
}

function safeName(name: unknown): name is string {
  return typeof name === 'string' && name.length > 0 && name.length <= 200 &&
    Array.from(name).every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
}

/** IDs choose bounded metadata records only; game paths and the active world are main-owned. */
export function createActiveBuffMetadata(deps: MetadataDeps): (raw: unknown) => Promise<ActiveBuffNames> {
  return async (raw) => {
    const request = activeBuffNameRequest(raw)
    if (!request) throw new Error('Invalid active-effect spell IDs.')
    const scope = deps.scope()
    if (!scope.root || scope.characterName?.toLowerCase() !== request.characterName.toLowerCase()) throw new Error('The active character changed.')
    const spells = request.spellIds.length ? await deps.spells(scope.root, request.spellIds) : []
    if (JSON.stringify(deps.scope()) !== JSON.stringify(scope)) throw new Error('The character or game folder changed while reading effect names.')
    const wanted = new Set(request.spellIds)
    const names: ActiveBuffNames = {}
    for (const spell of spells) {
      if (wanted.has(spell.id) && safeName(spell.name)) names[spell.id] = spell.name
    }
    return names
  }
}
