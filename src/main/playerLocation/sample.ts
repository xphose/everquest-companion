import type { PlayerLocation, PlayerLocationResult } from '../../shared/playerLocation'
import { LEGENDS_PROFILE as P, exactRead, pointerAt, readableAddress, type MemoryRead } from './profile'
import { readActivePlayerProfile } from './activeClasses'

const NOT_IN_WORLD: PlayerLocationResult = {
  state: 'not-in-world', reason: 'Waiting for a stable player location in the game world.'
}

function terminatedAscii(bytes: Buffer): string | null {
  const end = bytes.indexOf(0)
  if (end < 1 || !bytes.subarray(0, end).every(byte => byte >= 32 && byte < 127)) return null
  return bytes.toString('ascii', 0, end)
}

function playerName(bytes: Buffer): string | null {
  const name = terminatedAscii(bytes)
  return name && /^[A-Za-z][A-Za-z'-]{1,62}$/.test(name) ? name : null
}

function zoneName(bytes: Buffer): string | null {
  const name = terminatedAscii(bytes)
  return name && /^[a-z][a-z0-9_]{0,62}$/.test(name) ? name : null
}

interface WorldIdentity {
  player: bigint
  world: bigint
  zoneId: number
  zoneEntry: bigint
}

function readZoneId(read: MemoryRead, player: bigint): number {
  return exactRead(read, player + BigInt(P.zoneId), 4).readUInt32LE() & 0x7fff
}

function zoneSlot(world: bigint, zoneId: number): bigint {
  return world + BigInt(P.zoneTable + zoneId * 8)
}

function readWorld(read: MemoryRead, base: bigint): WorldIdentity | null {
  const player = pointerAt(read, base + P.playerRva)
  const world = pointerAt(read, base + P.worldRva)
  if (!readableAddress(player) || !readableAddress(world)) return null
  const zoneId = readZoneId(read, player)
  if (zoneId < 1 || zoneId > 1000) return null
  const zoneEntry = pointerAt(read, zoneSlot(world, zoneId))
  return readableAddress(zoneEntry) ? { player, world, zoneId, zoneEntry } : null
}

function stillSameWorld(read: MemoryRead, base: bigint, initial: WorldIdentity): boolean {
  // Movement between reads is expected. Requiring equal coordinates would hide a moving player;
  // the coherence check instead pins the player, world, zone and zone-table entry identities.
  return pointerAt(read, base + P.playerRva) === initial.player &&
    pointerAt(read, base + P.worldRva) === initial.world &&
    readZoneId(read, initial.player) === initial.zoneId &&
    pointerAt(read, zoneSlot(initial.world, initial.zoneId)) === initial.zoneEntry
}

function readPosition(read: MemoryRead, player: bigint): Omit<PlayerLocation, 'zone' | 'sampledAt'> | null {
  const start = P.ns
  const bytes = exactRead(read, player + BigInt(start), P.type - start + 1)
  const name = playerName(bytes.subarray(P.name - start, P.name - start + 64))
  if (!name || bytes[P.type - start] !== 0) return null
  const ns = bytes.readFloatLE(0)
  const ew = bytes.readFloatLE(P.ew - start)
  const z = bytes.readFloatLE(P.z - start)
  const heading = bytes.readFloatLE(P.heading - start)
  if (![ns, ew, z].every(value => Number.isFinite(value) && Math.abs(value) <= 1_000_000)) return null
  if (!Number.isFinite(heading) || heading < 0 || heading >= 512) return null
  return { characterName: name, ns, ew, z, heading }
}

function readLevel(read: MemoryRead, player: bigint): number | undefined {
  try {
    const level = exactRead(read, player + BigInt(P.level), 1).readUInt8()
    return level >= 1 && level <= 125 ? level : undefined
  } catch {
    // This optional byte must not remove an otherwise valid map position when unreadable.
    return undefined
  }
}

/** Read only the local-player fields and its zone metadata, with no entity enumeration. */
export function samplePlayer(read: MemoryRead, base: bigint, now: () => number = Date.now): PlayerLocationResult {
  const identity = readWorld(read, base)
  if (!identity) return NOT_IN_WORLD
  const position = readPosition(read, identity.player)
  if (!position) return NOT_IN_WORLD
  const zoneBytes = exactRead(read, identity.zoneEntry + BigInt(P.zoneEntryId), 68)
  const zone = zoneName(zoneBytes.subarray(P.zoneShortName - P.zoneEntryId))
  if (!zone || zoneBytes.readUInt32LE() !== identity.zoneId) return NOT_IN_WORLD
  const level = readLevel(read, identity.player)
  const profile = readActivePlayerProfile(read, base)
  const freshName = playerName(exactRead(read, identity.player + BigInt(P.name), 64))
  const freshType = exactRead(read, identity.player + BigInt(P.type), 1)[0]
  if (freshName !== position.characterName || freshType !== 0) return NOT_IN_WORLD
  if (!stillSameWorld(read, base, identity)) return NOT_IN_WORLD
  return {
    state: 'live',
    location: { ...position, zone, ...(level === undefined ? {} : { level }),
      ...profile, sampledAt: now() }
  }
}
