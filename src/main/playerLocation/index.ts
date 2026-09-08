import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { LocationClient, type PlayerLocationReader } from './client'
import { LOCATION_UNSUPPORTED } from './protocol'

/** Main supplies its own discovered installation root; no renderer-selected executable or PID. */
export function createPlayerLocationReader(): PlayerLocationReader {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    return { read: () => Promise.resolve(LOCATION_UNSUPPORTED), close: () => undefined }
  }
  return new LocationClient(() => new Worker(join(__dirname, 'playerLocationWorker.js')))
}
