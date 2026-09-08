import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestContext } from 'node:test'
import type { MacroSpell } from '../src/shared/macros.ts'
import type { PlayerLocationResult } from '../src/shared/playerLocation.ts'
import type { MacroServiceDeps, MacroWorld } from '../src/main/macros/types.ts'
import { createMacroService } from '../src/main/macros/service.ts'
import { createMacroRepository } from '../src/main/macros/repository.ts'

export const ORIGINAL_INI = '; existing character settings\r\n[Socials]\r\nPage1Button1Name=Mine\r\nPage1Button1Line1=/say preserved\r\n[HotButtons]\r\nPage1Button1=E0,@-1,0000000000000000,0,,\r\n[Other]\r\nAccent=\xe9\r\n'
export const DAMAGE: MacroSpell = { id: 94, name: 'Test Flame', classLevels: { MAG: 1 }, castMs: 2500, recoveryMs: 1500,
  recastMs: 0, mana: 10, targetType: 5, effects: [{ effect: 0, base: -10 }] }

export async function macroFixture(t: TestContext): Promise<{
  root: string; folder: string; name: string; deps: MacroServiceDeps
  service: ReturnType<typeof createMacroService>; world: MacroWorld
  read(): Promise<string>; write(text: string): Promise<void>; setPlayer(value: PlayerLocationResult): void
  live(): PlayerLocationResult; calls(): number
}> {
  const folder = await mkdtemp(join(tmpdir(), 'macro-service-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const root = join(folder, 'game')
  await mkdir(root)
  const name = 'Example_test_LO1.ini'
  await writeFile(join(root, name), ORIGINAL_INI, 'latin1')
  const world: MacroWorld = { character: { name: 'Example', server: 'test', logPath: join(root, 'Logs', 'eqlog_Example_test.txt') },
    characterId: 'Example@test', root, token: 'world-one' }
  const live = (): PlayerLocationResult => ({ state: 'live', location: { characterName: 'Example', zone: 'test', ns: 1, ew: 2,
    z: 3, heading: 4, sampledAt: 10_000, classes: ['MAG', 'SHM', 'ENC'], level: 10, spellbook: [94],
    memorizedSpells: [94, ...Array<null>(17).fill(null)], unlockedSpellSlots: [1, 2, 3, 4, 5, 6, 7, 8] } })
  let player = live()
  let count = 0
  const deps: MacroServiceDeps = { world: () => ({ ...world }), livePlayer: async () => { count++; return structuredClone(player) },
    spells: async () => [DAMAGE], repository: createMacroRepository(join(folder, 'private')), backupDir: join(folder, 'backups'), now: () => 10_000 }
  return { folder, root, name, world, deps, live, service: createMacroService(deps), calls: () => count,
    read: () => readFile(join(root, name), 'latin1'), write: (text) => writeFile(join(root, name), text, 'latin1'),
    setPlayer: (value) => { player = value } }
}

export const STOPPED: PlayerLocationResult = { state: 'not-running', reason: 'The game has exited.' }
