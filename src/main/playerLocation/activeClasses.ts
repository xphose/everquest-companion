import type { ClassAbbr } from '../../shared/classCombo'
import { LEGENDS_PROFILE as P, exactRead, pointerAt, readableAddress, type MemoryRead } from './profile'

// Native IDs 1..16, independently confirmed by this build's class-name table. Bit zero is unused.
const CLASS_IDS: readonly ClassAbbr[] = [
  'WAR', 'CLR', 'PAL', 'RNG', 'SHD', 'DRU', 'MNK', 'BRD',
  'ROG', 'SHM', 'NEC', 'WIZ', 'MAG', 'ENC', 'BST', 'BER'
]
const VALID_CLASS_BITS = 0x1fffe
const MAX_PROFILE_LISTS = 8

/** A complete active set only: never report one plausible class from a damaged/unknown mask. */
export function classesFromMask(mask: number): ClassAbbr[] | undefined {
  if (!Number.isInteger(mask) || mask < 0 || mask > VALID_CLASS_BITS || (mask & ~VALID_CLASS_BITS) !== 0) return undefined
  const classes = CLASS_IDS.filter((_class, index) => (mask & (1 << (index + 1))) !== 0)
  return classes.length >= 2 && classes.length <= 3 ? classes : undefined
}

interface ActiveProfile {
  owner: bigint
  descriptor: bigint
  manager: bigint
  kind: number
  head: bigint
  node: bigint
  profile: bigint
  mask: number
}

function currentProfile(read: MemoryRead, manager: bigint): Pick<ActiveProfile, 'kind' | 'head' | 'node' | 'profile'> | null {
  const head = pointerAt(read, manager)
  const kind = exactRead(read, manager + BigInt(P.profileCurrentType), 4).readUInt32LE()
  const visited = new Set<bigint>()
  let node = head
  for (let count = 0; count < MAX_PROFILE_LISTS; count++) {
    if (!readableAddress(node) || visited.has(node)) return null
    visited.add(node)
    const type = exactRead(read, node + BigInt(P.profileListType), 4).readUInt32LE()
    if (type === kind) {
      const profile = pointerAt(read, node + BigInt(P.profileListFirst))
      return readableAddress(profile) ? { kind, head, node, profile } : null
    }
    node = pointerAt(read, node + BigInt(P.profileListNext))
  }
  return null
}

function activeProfile(read: MemoryRead, base: bigint): ActiveProfile | null {
  const owner = pointerAt(read, base + P.characterRva)
  if (!readableAddress(owner)) return null
  const descriptor = pointerAt(read, owner + BigInt(P.characterDescriptor))
  if (descriptor !== base + P.characterDescriptorRva) return null
  const displacement = exactRead(read, descriptor + BigInt(P.descriptorDisplacement), 4).readInt32LE()
  if (displacement !== P.profileManagerDisplacement) return null
  const manager = owner + BigInt(P.profileManagerBias + displacement)
  const selected = currentProfile(read, manager)
  if (!selected) return null
  const mask = exactRead(read, selected.profile + BigInt(P.classMask), 4).readUInt32LE()
  return { owner, descriptor, manager, ...selected, mask }
}

function sameProfile(initial: ActiveProfile, final: ActiveProfile | null): boolean {
  if (!final) return false
  return initial.owner === final.owner && initial.descriptor === final.descriptor &&
    initial.manager === final.manager && initial.kind === final.kind && initial.head === final.head &&
    initial.node === final.node && initial.profile === final.profile && initial.mask === final.mask
}

/**
 * Read the same active profile used by the client's class-sensitive spell eligibility checks.
 * It is not the learned-class table or a saved loadout. The chain is bounded and resolved twice;
 * any loading/swap race omits classes while the independent location read can remain useful.
 */
export function readActiveClasses(read: MemoryRead, base: bigint): ClassAbbr[] | undefined {
  try {
    const initial = activeProfile(read, base)
    if (!initial) return undefined
    const classes = classesFromMask(initial.mask)
    if (!classes || !sameProfile(initial, activeProfile(read, base))) return undefined
    return pointerAt(read, base + P.characterRva) === initial.owner ? classes : undefined
  } catch {
    return undefined
  }
}
