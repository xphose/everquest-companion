import type { PlayerLocationResult } from '../../shared/playerLocation'
import { LOCATION_UNAVAILABLE, parseLocationReply, type LocationRequest } from './protocol'

/** The small worker surface also lets lifecycle tests exercise timeouts without native code. */
export interface LocationWorker {
  postMessage(value: unknown): void
  unref(): void
  on(event: 'message', handler: (value: unknown) => void): this
  on(event: 'error', handler: (error: Error) => void): this
  on(event: 'exit', handler: (code: number) => void): this
}

export interface PlayerLocationReader {
  read(root: string | null): Promise<PlayerLocationResult>
  close(): void
}

interface PendingRead {
  id: number
  root: string | null
  promise: Promise<PlayerLocationResult>
  resolve: (result: PlayerLocationResult) => void
  timer: ReturnType<typeof setTimeout>
}

interface WorkerSession {
  worker: LocationWorker
  stopping: boolean
  pending: PendingRead | null
}

/**
 * At most one native worker and one sample are alive. A timeout rejects the sample immediately,
 * then requests a cooperative stop. NEVER terminate a koffi thread: doing so inside a native
 * call can abort the app (AGENTS.md JOS-182). A replacement waits for the old thread to exit.
 */
export class LocationClient implements PlayerLocationReader {
  private session: WorkerSession | null = null
  private nextId = 0
  private closed = false

  constructor(private readonly startWorker: () => LocationWorker, private readonly timeoutMs = 3000) {}

  private finish(session: WorkerSession, result: PlayerLocationResult): void {
    const pending = session.pending
    session.pending = null
    if (!pending) return
    clearTimeout(pending.timer)
    pending.resolve(result)
  }

  private stop(session: WorkerSession): void {
    this.finish(session, LOCATION_UNAVAILABLE)
    if (session.stopping) return
    session.stopping = true
    try {
      session.worker.postMessage({ type: 'stop' })
    } catch {
      // A worker that already closed its port will report exit; do not force native termination.
      session.worker.unref()
    }
  }

  private start(): WorkerSession {
    const worker = this.startWorker()
    const session: WorkerSession = { worker, stopping: false, pending: null }
    this.session = session
    worker.on('message', value => {
      const reply = parseLocationReply(value)
      if (!reply) {
        this.stop(session)
        return
      }
      if (!session.stopping && reply.id === session.pending?.id) this.finish(session, reply.result)
    })
    worker.on('error', () => this.stop(session))
    worker.on('exit', () => {
      this.finish(session, LOCATION_UNAVAILABLE)
      if (this.session === session) this.session = null
    })
    worker.unref()
    return session
  }

  private request(session: WorkerSession, root: string | null): Promise<PlayerLocationResult> {
    const id = ++this.nextId
    let resolve: (result: PlayerLocationResult) => void = () => undefined
    const promise = new Promise<PlayerLocationResult>(done => { resolve = done })
    const timer = setTimeout(() => this.stop(session), this.timeoutMs)
    timer.unref()
    session.pending = { id, root, promise, resolve, timer }
    const message: LocationRequest = { type: 'read', id, root }
    try {
      session.worker.postMessage(message)
    } catch {
      this.stop(session)
    }
    return promise
  }

  read(root: string | null): Promise<PlayerLocationResult> {
    if (this.closed) return Promise.resolve(LOCATION_UNAVAILABLE)
    try {
      const session = this.session ?? this.start()
      if (session.stopping) return Promise.resolve(LOCATION_UNAVAILABLE)
      if (!session.pending) return this.request(session, root)
      if (session.pending.root === root) return session.pending.promise
      this.stop(session)
      return Promise.resolve(LOCATION_UNAVAILABLE)
    } catch {
      return Promise.resolve(LOCATION_UNAVAILABLE)
    }
  }

  close(): void {
    this.closed = true
    if (this.session) this.stop(this.session)
  }
}
