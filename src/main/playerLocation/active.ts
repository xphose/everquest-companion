import { app } from 'electron'
import type { PlayerLocationResult } from '../../shared/playerLocation'
import { effectiveEqRoot } from '../log/config'
import { getActiveCharacter } from '../session'
import { engineWorldToken } from '../dataServer/engineClientHost'
import { createPlayerLocationReader } from './index'
import type { PlayerLocationReader } from './client'

let reader: PlayerLocationReader | undefined

/** Maps and journal share one worker. No native polling runs when neither view requests data. */
export async function readActivePlayer(): Promise<PlayerLocationResult> {
  if (!reader) {
    reader = createPlayerLocationReader()
    app.once('before-quit', () => reader?.close())
  }
  const root = effectiveEqRoot()
  const character = getActiveCharacter()
  const token = engineWorldToken()
  const result = await reader.read(root)
  if (root !== effectiveEqRoot() || character?.logPath !== getActiveCharacter()?.logPath || token !== engineWorldToken()) {
    return { state: 'unavailable', reason: 'Character changed. Refreshing location…' }
  }
  if (result.state === 'live' && character && result.location.characterName.toLowerCase() !== character.name.toLowerCase()) {
    return { state: 'unavailable', reason: 'Select the character currently playing to show its location.' }
  }
  return result
}
