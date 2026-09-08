import test from 'node:test'
import assert from 'node:assert/strict'
import { createLocationSampler } from '../src/main/playerLocation/reader.ts'
import { FingerprintCache, type FingerprintFiles } from '../src/main/playerLocation/fingerprint.ts'
import { sameExecutable } from '../src/main/playerLocation/paths.ts'
import type { LocationNative, ProcessMemory } from '../src/main/playerLocation/native.ts'
import { locationFixture } from './playerLocationFixture.mts'

const EXE = 'C:\\Games\\EverQuest Legends\\eqgame.exe'
const DIGEST = 'f1c6ab2f07a5d08e62bb936061fd01049fa7b64ce8ddac50c57009162088a9f9'

function readerFixture() {
  const fixture = locationFixture()
  const calls = { opens: 0, closes: 0, checks: 0, cacheCloses: 0, scans: 0 }
  const memory: ProcessMemory = {
    imagePath: () => EXE,
    imageBase: () => fixture.base,
    read: fixture.read,
    close: () => { calls.closes++ }
  }
  const native: LocationNative = {
    matchingProcesses: executable => { assert.equal(executable, EXE); calls.scans++; return [91] },
    openPlayerProcess: pid => { assert.equal(pid, 91); calls.opens++; return memory }
  }
  const fingerprint = {
    supports: () => { calls.checks++; return true },
    close: () => { calls.cacheCloses++ }
  }
  const reader = createLocationSampler(native, { fingerprint, executable: () => EXE, now: () => 25 })
  return { ...fixture, calls, memory, native, fingerprint, reader }
}

test('reader closes the process after every successful sample and drops its cache on close', () => {
  const fixture = readerFixture()
  assert.equal(fixture.reader.read('C:\\Games\\EverQuest Legends').state, 'live')
  assert.equal(fixture.calls.opens, 1)
  assert.equal(fixture.calls.closes, 1)
  fixture.reader.close()
  assert.equal(fixture.calls.cacheCloses, 1)
  assert.equal(fixture.reader.read('C:\\Games').state, 'unavailable')
  assert.equal(fixture.calls.opens, 1)
})

test('missing install, no game and multiple games never open a process for memory reading', () => {
  const fixture = readerFixture()
  assert.equal(fixture.reader.read(null).state, 'unavailable')
  assert.equal(fixture.calls.scans, 0)
  fixture.native.matchingProcesses = () => []
  assert.equal(fixture.reader.read('root').state, 'not-running')
  fixture.native.matchingProcesses = () => [91, 92]
  assert.equal(fixture.reader.read('root').state, 'ambiguous')
  assert.equal(fixture.calls.opens, 0)
})

test('unsupported disk version refuses to open memory and a mapped mismatch refuses all player fields', () => {
  const fixture = readerFixture()
  fixture.fingerprint.supports = () => false
  assert.equal(fixture.reader.read('root').state, 'unsupported')
  assert.equal(fixture.calls.opens, 0)
  fixture.fingerprint.supports = () => true
  fixture.image.writeUInt32LE(0x11111111, 0x100)
  assert.equal(fixture.reader.read('root').state, 'unsupported')
  assert.ok(fixture.reads.every(value => value.address < fixture.base + 4096n))
  assert.equal(fixture.calls.closes, 1)
})

test('a reused PID from another executable is rejected before any memory read', () => {
  const fixture = readerFixture()
  fixture.memory.imagePath = () => 'C:\\Other Game\\eqgame.exe'
  assert.equal(fixture.reader.read('root').state, 'unavailable')
  assert.equal(fixture.reads.length, 0)
  assert.equal(fixture.calls.closes, 1)
})

test('game exit, failed read, partial read, permissions and scan faults return no stale location', () => {
  const fixture = readerFixture()
  assert.equal(fixture.reader.read('root').state, 'live')
  fixture.memory.read = () => null
  assert.deepEqual(fixture.reader.read('root').state, 'unavailable')
  fixture.memory.read = () => Buffer.alloc(1)
  assert.equal(fixture.reader.read('root').state, 'unavailable')
  assert.equal(fixture.calls.closes, 3)
  fixture.native.openPlayerProcess = () => null
  assert.equal(fixture.reader.read('root').state, 'unavailable')
  fixture.native.matchingProcesses = () => { throw new Error('Query failed') }
  const result = fixture.reader.read('root')
  assert.equal(result.state, 'unavailable')
  assert.equal('location' in result, false)
})

test('Windows process matching requires the complete configured executable path', () => {
  assert.equal(sameExecutable('c:/GAMES/EverQuest Legends/eqgame.exe', EXE), true)
  assert.equal(sameExecutable('\\\\?\\' + EXE, EXE), true)
  assert.equal(sameExecutable(EXE + '.backup', EXE), false)
  assert.equal(sameExecutable('C:\\Games\\Other\\eqgame.exe', EXE), false)
})

test('disk fingerprint hashes once per unchanged identity and invalidates on changes and cleanup', () => {
  let key = 'file-1:size:mtime:ctime'
  let hashes = 0
  let supported = true
  const files: FingerprintFiles = {
    inspect: () => ({ key, size: 15_528_056n }),
    digest: () => { hashes++; return supported ? DIGEST : '0'.repeat(64) }
  }
  const cache = new FingerprintCache(files)
  for (let sample = 0; sample < 20; sample++) assert.equal(cache.supports(EXE), true)
  assert.equal(hashes, 1)
  key = 'file-1:size:mtime2:ctime2'
  supported = false
  assert.equal(cache.supports(EXE), false)
  assert.equal(cache.supports(EXE), false)
  assert.equal(hashes, 2)
  key = 'replacement-file:size:mtime2:ctime2'
  supported = true
  assert.equal(cache.supports(EXE), true)
  assert.equal(hashes, 3)
  cache.close()
  assert.equal(cache.supports(EXE), true)
  assert.equal(hashes, 4)
  assert.equal(cache.supports('C:\\Other\\eqgame.exe'), true)
  assert.equal(hashes, 5)
})

test('oversize game files are not read and failed fingerprinting cannot reuse an earlier verdict', () => {
  let hashes = 0
  let size = 15_528_056n
  const files: FingerprintFiles = {
    inspect: () => ({ key: String(size), size }),
    digest: () => { hashes++; return DIGEST }
  }
  const cache = new FingerprintCache(files)
  assert.equal(cache.supports(EXE), true)
  size = 15_528_057n
  assert.equal(cache.supports(EXE), false)
  assert.equal(hashes, 1)
  files.inspect = () => { throw new Error('File missing') }
  assert.throws(() => cache.supports(EXE), /File missing/)
})
