export interface OverlaySnapshot<S> { state: S; seq?: number }
export interface OverlaySnapshotDeps<S> {
  read(): Promise<OverlaySnapshot<S> | null>
  receive(state: S | null, rebuilt: boolean): void
  retry?: (run: () => void) => () => void
}

function retryLater(run: () => void): () => void {
  const timer = setTimeout(run, 1000)
  return () => clearTimeout(timer)
}

/** One in-flight read, with coalesced cursors and a generation for character/world changes.
 * Unavailable answers clear the screen and retry at most once per second while idle. */
export class OverlaySnapshotReader<S> {
  private generation = 0
  private disposed = false
  private fetching = false
  private dirty = false
  private seq = -1
  private wantedSeq = -1
  private rebuilt = true
  private cancelRetry?: () => void

  constructor(private readonly deps: OverlaySnapshotDeps<S>) {}

  request(seq?: number): void {
    if (this.disposed) return
    if (seq === undefined) this.dirty = true
    else this.wantedSeq = Math.max(this.wantedSeq, seq)
    this.pump()
  }

  reset(): void {
    if (this.disposed) return
    this.generation++
    this.seq = -1
    this.wantedSeq = -1
    this.dirty = true
    this.rebuilt = true
    this.clearRetry()
    this.deps.receive(null, true)
    this.pump()
  }

  dispose(): void {
    this.disposed = true
    this.generation++
    this.clearRetry()
  }

  private clearRetry(): void {
    this.cancelRetry?.()
    this.cancelRetry = undefined
  }

  private unavailable(): void {
    this.seq = -1
    this.wantedSeq = -1
    this.dirty = true
    this.rebuilt = true
    this.deps.receive(null, true)
    this.retry()
  }

  private retry(): void {
    this.cancelRetry = (this.deps.retry ?? retryLater)(() => {
      this.cancelRetry = undefined
      this.pump()
    })
  }

  private accept(snapshot: OverlaySnapshot<S> | null): void {
    if (!snapshot) { this.unavailable(); return }
    const before = this.seq
    this.seq = snapshot.seq ?? -1
    this.deps.receive(snapshot.state, this.rebuilt)
    this.rebuilt = false
    // A delayed cursor can name an older world. Never spin if the new engine cannot reach it.
    if (this.wantedSeq > this.seq && this.seq <= before) this.retry()
  }

  private pump(): void {
    if (this.disposed || this.fetching || this.cancelRetry || !this.dirty && this.wantedSeq <= this.seq) return
    this.fetching = true
    this.dirty = false
    const born = this.generation
    void Promise.resolve().then(() => this.deps.read()).then((snapshot) => {
      if (!this.disposed && born === this.generation) this.accept(snapshot)
    }).catch(() => {
      if (!this.disposed && born === this.generation) this.unavailable()
    }).finally(() => {
      this.fetching = false
      this.pump()
    })
  }
}
