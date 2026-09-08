/** Invented client rows in the observed 173-field shape; never copies a player's game data. */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication } from 'playwright-core'
import type { ClassAbbr } from '../../src/shared/classCombo'

export const PERSONAL_INI = '[Defaults]\r\nKeep=unchanged\r\n[Socials]\r\nPage2Button6Name=Pet Opener\r\nPage2Button6Color=0\r\nPage2Button6Line1=/pet attack\r\nPage2Button6Line2=/pause 30, cast 1\r\n[HotButtons2]\r\nPage1Button1=E17,@-1,0000000000000000,0,Personal,\r\n'
export const CHARACTER_INI = 'Primitive_freeport_LO1.ini'
export type MacroMode = 'live' | 'unavailable' | 'unsupported' | 'not-running'
interface NativeFixture {
  mode: MacroMode; classes: ClassAbbr[]; book: number[]; gems: (number | null)[]
  unlockedSpellSlots?: number[]; reads: number
}
interface MainFixture { macroFixture: NativeFixture }

function row(id: number, name: string, classColumn: number, effect: string): string {
  const fields = Array<string>(173).fill('0')
  fields[0] = String(id)
  fields[1] = name
  fields[8] = '2000'
  fields[9] = '1500'
  fields[10] = '2500'
  fields[14] = '10'
  // Legends' friendly-or-self target, observed in both healing and statistic buff rows.
  fields[30] = id === 2001 || id >= 3001 && id <= 3005 ? '51' : '5'
  for (let column = 36; column <= 51; column++) fields[column] = '255'
  fields[classColumn] = '1'
  fields[172] = effect
  return fields.join('^')
}

export function stageMacros(root: string): string {
  const rows = [
    row(1001, 'Test Flare I', 48, '0|0|-20|0|100|0'),
    row(1002, 'Test Flare II', 48, '0|0|-40|0|100|0'),
    row(1003, 'Unowned Fire', 48, '0|0|-80|0|100|0'),
    row(2001, 'Test Mend', 45, '0|0|20|0|100|0'),
    row(3001, 'Test Armor', 45, '0|1|10|0|100|0'),
    row(3002, 'Test Strength', 45, '0|4|10|0|100|0'),
    row(3003, 'Test Focus', 45, '0|5|10|0|100|0'),
    row(3004, 'Test Agility', 45, '0|6|10|0|100|0'),
    row(3005, 'Test Endurance', 45, '0|7|10|0|100|0'),
    row(4001, 'Test Familiar', 48, '0|33|1|0|100|0'),
    row(5001, 'Test Mesmerize', 49, '0|31|10|0|100|0')
  ]
  writeFileSync(join(root, 'spells_us.txt'), `${rows.join('\n')}\n`, 'latin1')
  const file = join(root, CHARACTER_INI)
  writeFileSync(file, PERSONAL_INI, 'latin1')
  return file
}

export async function controlMacroWorker(app: ElectronApplication, root: string): Promise<void> {
  await app.evaluate((_electron, stagedRoot) => {
    const { Worker } = process.getBuiltinModule('node:worker_threads') as typeof import('node:worker_threads')
    const state = globalThis as unknown as MainFixture
    const book = [1001, 2001, 3001, 3002, 4001, 5001]
    state.macroFixture = { mode: 'live', classes: ['MAG', 'SHM'], book,
      gems: [...book, ...Array<null>(12).fill(null)], unlockedSpellSlots: [1, 2, 3, 4, 5, 6, 7, 8], reads: 0 }
    const original = Worker.prototype.postMessage
    Worker.prototype.postMessage = function (value, ...transfer) {
      const request = value as { type?: string; id?: number; root?: string }
      if (request?.type !== 'read' || request.root !== stagedRoot || typeof request.id !== 'number') return original.call(this, value, ...transfer)
      const current = state.macroFixture
      current.reads++
      const result = current.mode === 'live' ? { state: 'live', location: {
        characterName: 'Primitive', classes: current.classes, level: 10, zone: 'qeynos2',
        ns: 1, ew: 2, z: 3, heading: 0, sampledAt: Date.now(),
        spellbook: current.book, memorizedSpells: current.gems,
        ...(current.unlockedSpellSlots === undefined ? {} : { unlockedSpellSlots: current.unlockedSpellSlots })
      } } : { state: current.mode, reason: `Staged ${current.mode}.` }
      queueMicrotask(() => this.emit('message', { id: request.id, result }))
    }
  }, root)
}

export async function publishMacroPlayer(app: ElectronApplication, update: Partial<Omit<NativeFixture, 'reads'>>): Promise<void> {
  await app.evaluate((_electron, change) => {
    Object.assign((globalThis as unknown as MainFixture).macroFixture, change)
  }, update)
}

export function macroReads(app: ElectronApplication): Promise<number> {
  return app.evaluate(() => (globalThis as unknown as MainFixture).macroFixture.reads)
}
