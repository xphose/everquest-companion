import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication } from 'playwright-core'
import type { ClassAbbr } from '../../src/shared/classCombo'
import { ZONES } from '../../src/shared/zones'
import { stageFixture, type FixtureLog } from './logFixture.mjs'

interface Reading { classes: ClassAbbr[]; level: number; name: string; zone: string; age: number; ns: number; ew: number }
interface NativeFixture { adventureReading: Reading }

export function stageAdventure(): FixtureLog {
  const log = stageFixture('cw7-who-swap-boundary-aug12.log', { others: { Journalalt: 'e2e-leveling.log' } })
  mkdirSync(join(log.installDir, 'maps'))
  const geometry = 'L -3000,-3000,0,3000,-3000,0,180,180,180\nL 3000,-3000,0,3000,3000,0,180,180,180\nL 3000,3000,0,-3000,3000,0,180,180,180\nL -3000,3000,0,-3000,-3000,0,180,180,180\n'
  for (const zone of ZONES) writeFileSync(join(log.installDir, 'maps', `${zone.short}.txt`), geometry)
  writeFileSync(join(log.installDir, 'maps', 'qrg_1.txt'), 'P 600,900,0,255,255,255,2,Adventure_Beacon\nP 1000,1000,0,255,255,255,2,to_Qeynos_Hills\n')
  return log
}

export async function controlAdventure(app: ElectronApplication, root: string): Promise<void> {
  await app.evaluate((_electron, stagedRoot) => {
    const { Worker } = process.getBuiltinModule('node:worker_threads') as typeof import('node:worker_threads')
    const fixture = globalThis as unknown as NativeFixture
    fixture.adventureReading = { classes: ['SHM', 'PAL', 'ROG'], level: 1, name: 'Primitive', zone: 'qrg', age: 0, ns: 120, ew: -80 }
    const original = Worker.prototype.postMessage
    Worker.prototype.postMessage = function (value, ...transfer) {
      const request = value as { type?: string; id?: number; root?: string }
      if (request?.type !== 'read' || request.root !== stagedRoot || typeof request.id !== 'number') return original.call(this, value, ...transfer)
      const current = fixture.adventureReading
      const result = { state: 'live', location: { characterName: current.name, zone: current.zone, classes: current.classes, level: current.level,
        ns: current.ns, ew: current.ew, z: 3, heading: 0, sampledAt: Date.now() - current.age } }
      queueMicrotask(() => this.emit('message', { id: request.id, result }))
    }
  }, root)
}

export async function publishAdventure(app: ElectronApplication, patch: Partial<Reading>): Promise<void> {
  await app.evaluate((_electron, value) => { Object.assign((globalThis as unknown as NativeFixture).adventureReading, value) }, patch)
}
