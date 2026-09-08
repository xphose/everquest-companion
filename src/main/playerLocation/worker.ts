import { parentPort } from 'node:worker_threads'
import { createLocationSampler, type LocationSampler } from './reader'
import { loadLocationNative } from './native'
import { LOCATION_UNAVAILABLE, LOCATION_UNSUPPORTED, parseLocationRequest, type LocationReply } from './protocol'
import type { PlayerLocationResult } from '../../shared/playerLocation'

const port = parentPort
let sampler: LocationSampler | null = null
let failure: PlayerLocationResult = LOCATION_UNAVAILABLE
try {
  if (process.platform === 'win32' && process.arch === 'x64') sampler = createLocationSampler(loadLocationNative())
  else failure = LOCATION_UNSUPPORTED
} catch {
  // Missing native binaries or unavailable Windows exports disable location, not the companion.
  failure = LOCATION_UNAVAILABLE
}

port?.on('message', (message: unknown) => {
  if (message && typeof message === 'object' && 'type' in message && message.type === 'stop') {
    // The port callback runs BETWEEN synchronous native reads, so cleanup cannot race koffi.
    sampler?.close()
    sampler = null
    port.close()
    return
  }
  const request = parseLocationRequest(message)
  if (!request) return
  const reply: LocationReply = { id: request.id, result: sampler?.read(request.root) ?? failure }
  port.postMessage(reply)
})
