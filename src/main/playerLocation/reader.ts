import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import type { PlayerLocationResult } from '../../shared/playerLocation'
import { FingerprintCache } from './fingerprint'
import { matchesMappedImage, type LocationProfile } from './profile'
import type { LocationNative, ProcessMemory } from './native'
import { sameExecutable } from './paths'
import { samplePlayer } from './sample'
import { LOCATION_UNAVAILABLE as READ_UNAVAILABLE } from './protocol'
const UNSUPPORTED_BUILD: PlayerLocationResult = {
  state: 'unsupported', reason: 'This game version is not supported for automatic location yet.'
}

export interface LocationSampler {
  read(root: string | null): PlayerLocationResult
  close(): void
}

interface SamplerOptions {
  fingerprint?: Pick<FingerprintCache, 'select' | 'close'>
  executable?: (root: string) => string
  now?: () => number
}

function sampleProcess(memory: ProcessMemory, executable: string, now: () => number, profile: LocationProfile): PlayerLocationResult {
  // Re-check the handle's path after opening: a PID can be reused between enumeration and open.
  const path = memory.imagePath()
  if (!path || !sameExecutable(path, executable)) return READ_UNAVAILABLE
  const base = memory.imageBase()
  if (!base) return READ_UNAVAILABLE
  if (!matchesMappedImage(memory.read, base, profile)) return UNSUPPORTED_BUILD
  return samplePlayer(memory.read, base, now, profile)
}

/** All filesystem work and process calls happen synchronously on the worker, never on main. */
export function createLocationSampler(native: LocationNative, options: SamplerOptions = {}): LocationSampler {
  const fingerprint = options.fingerprint ?? new FingerprintCache()
  const executableAt = options.executable ?? (root => realpathSync.native(join(root, 'eqgame.exe')))
  const now = options.now ?? Date.now
  let closed = false
  function read(root: string | null): PlayerLocationResult {
    if (closed) return READ_UNAVAILABLE
    if (!root) return { state: 'unavailable', reason: 'Select the EverQuest installation in Settings to enable automatic location.' }
    try {
      const executable = executableAt(root)
      const pids = native.matchingProcesses(executable)
      if (pids.length === 0) return { state: 'not-running', reason: 'Waiting for EverQuest to start.' }
      if (pids.length > 1) return { state: 'ambiguous', reason: 'More than one game is running from this installation.' }
      const profile = fingerprint.select(executable)
      if (!profile) return UNSUPPORTED_BUILD
      const memory = native.openPlayerProcess(pids[0])
      if (!memory) return { state: 'unavailable', reason: 'Windows could not grant read access to the game location.' }
      try {
        return sampleProcess(memory, executable, now, profile)
      } finally {
        memory.close()
      }
    } catch {
      // No stale position survives a game exit, loading race, denied read or changing disk image.
      return READ_UNAVAILABLE
    }
  }
  return {
    read,
    close() {
      closed = true
      fingerprint.close()
    }
  }
}
