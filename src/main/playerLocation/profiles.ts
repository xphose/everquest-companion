import { LEGENDS_PROFILE, type LocationProfile } from './profile'

// Inherited layouts were independently rechecked; provenance is in native-client-2026-09-08.md.
export const LEGENDS_20260908_PROFILE: LocationProfile = Object.freeze({
  ...LEGENDS_PROFILE,
  sha256: '412ca5fd0be010bde1dd4df19a2b0a7217fe4e957eeed8280e9ca4f980f8f74f',
  fileSize: 15_534_712,
  timestamp: 0x6a9f67b3,
  imageSize: 0x16c7000,
  playerRva: 0xf0d360n,
  worldRva: 0xf0ce50n,
  characterRva: 0xf0d4b0n,
  characterDescriptorRva: 0x9a9968n,
  characterZoneDescriptorRva: 0x9a9970n,
  spellManagerRva: 0xf93118n,
  zoneId: 0x358,
  level: 0x32c
})

/** Exact verified builds only. A new patch must be independently checked before joining this list. */
export const LOCATION_PROFILES: readonly LocationProfile[] = Object.freeze([LEGENDS_PROFILE, LEGENDS_20260908_PROFILE])

export function knownProfileSize(size: bigint): boolean {
  return LOCATION_PROFILES.some(profile => BigInt(profile.fileSize) === size)
}

export function profileForFingerprint(size: bigint, sha256: string): LocationProfile | null {
  return LOCATION_PROFILES.find(profile => BigInt(profile.fileSize) === size && profile.sha256 === sha256) ?? null
}
