/** Authored metadata and private character settings in the test's temporary install only. */
import { appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PERSONAL_INI, stageMacros } from './macroFixture.mjs'

export const PREPARATION_BOOK = [1001, 2001, 3001, 3002, 4001, 5001, 50, 211, 80]
export const COMBAT_GEMS = [1001, 2001, 3001, 3002, 4001, 5001, 50, ...Array<null>(11).fill(null)]
export const PREPARATION_INI = `${PERSONAL_INI}[SpellLoadouts]\r\nSpellLoadout2.inuse=0\r\nSpellLoadout2.name=Personal inactive\r\nSpellLoadout2.slot1=1001\r\n`
export const PREPARATION_DEFAULTS = '[SpellLoadouts]\r\nSpellLoadout1.inuse=1\r\nSpellLoadout1.name=Personal default\r\nSpellLoadout1.slot1=2001\r\n'

function row(id: number, name: string, info: { effect: number; base: number; target: number; column: number }): string {
  const fields = Array<string>(173).fill('0')
  fields[0] = String(id); fields[1] = name
  fields[8] = '2000'; fields[9] = '1500'; fields[14] = '10'; fields[30] = String(info.target)
  for (let i = 36; i <= 51; i++) fields[i] = '255'
  fields[info.column] = '1'
  fields[172] = `0|${info.effect}|${info.base}|0|100|0`
  return fields.join('^')
}
export function stagePreparation(root: string): string {
  const file = stageMacros(root)
  const rows = [row(50, 'Summon Food', { effect: 32, base: 13078, target: 6, column: 48 }),
    row(211, 'Summon Drink', { effect: 32, base: 13079, target: 6, column: 48 }),
    row(80, 'Test Clear Vision', { effect: 13, base: 1, target: 51, column: 49 })]
  appendFileSync(join(root, 'spells_us.txt'), `${rows.join('\n')}\n`, 'latin1')
  writeFileSync(file, PREPARATION_INI, 'latin1')
  writeFileSync(join(root, 'defaults.ini'), PREPARATION_DEFAULTS, 'latin1')
  return file
}
