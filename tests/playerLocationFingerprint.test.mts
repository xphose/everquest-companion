import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FingerprintCache, type FingerprintFiles } from '../src/main/playerLocation/fingerprint.ts'
import { LOCATION_PROFILES } from '../src/main/playerLocation/profiles.ts'

test('disk hashing reads each registered build size fully and rejects matching-size unknown bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'eqc-profile-fingerprint-'))
  const cache = new FingerprintCache()
  try {
    for (const profile of LOCATION_PROFILES) {
      const executable = join(root, `${profile.fileSize}.exe`)
      // Synthetic zero bytes expose a hardcoded old-length read as an exception on a newer size.
      writeFileSync(executable, Buffer.alloc(profile.fileSize))
      assert.equal(cache.select(executable), null)
      assert.equal(cache.select(executable), null)
    }
  } finally {
    cache.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('patching an unchanged install path selects the new exact build without carrying a previous profile', () => {
  let selected = LOCATION_PROFILES[0]
  let digest = selected.sha256
  let hashes = 0
  const files: FingerprintFiles = {
    inspect: () => ({ key: `${selected.fileSize}:${digest}`, size: BigInt(selected.fileSize) }),
    digest: (_path, identity) => { assert.equal(identity.size, BigInt(selected.fileSize)); hashes++; return digest }
  }
  const cache = new FingerprintCache(files)
  for (const profile of LOCATION_PROFILES) {
    selected = profile
    digest = profile.sha256
    assert.equal(cache.select('same-install'), profile)
    assert.equal(cache.select('same-install'), profile)
  }
  assert.equal(hashes, LOCATION_PROFILES.length)
  digest = '0'.repeat(64)
  assert.equal(cache.select('same-install'), null)
  digest = LOCATION_PROFILES[0].sha256
  selected = LOCATION_PROFILES[0]
  assert.equal(cache.select('same-install'), selected)
  assert.equal(hashes, LOCATION_PROFILES.length + 2)
})
