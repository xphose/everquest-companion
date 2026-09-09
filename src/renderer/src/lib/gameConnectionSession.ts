import { CHECKING_GAME, gameConnection, type GameConnectionStatus } from '../../../shared/gameConnection'
import type { PlayerLocationResult } from '../../../shared/playerLocation'

export interface GameConnectionView { contextKey: string; status: GameConnectionStatus }
const READ_TIMEOUT_MS = 4000
const READER_UNAVAILABLE: PlayerLocationResult = { state: 'unavailable', reason: 'The game reader did not respond.' }
const overdue = (elapsed: number): boolean => !Number.isFinite(elapsed) || elapsed < 0 || elapsed > READ_TIMEOUT_MS

/** One IPC at a time. Main bounds native reads at three seconds; a delayed renderer reply
 * must expire too, without building a queue of duplicate IPC requests behind it. */
export class GameConnectionSession {
  private active = true
  private generation = 0
  private contextKey = ''
  private characterName: string | undefined
  private result: PlayerLocationResult | undefined
  private pending: Promise<void> | null = null
  private startedAt = 0
  private timedOut = false
  private published: GameConnectionView | undefined

  constructor(private readonly observe: () => Promise<PlayerLocationResult>,
    private readonly changed: (view: GameConnectionView) => void, private readonly now: () => number = Date.now) {}

  setContext(contextKey: string, characterName: string | undefined): void {
    if (contextKey === this.contextKey && characterName === this.characterName) return
    this.contextKey = contextKey
    this.characterName = characterName
    this.invalidate()
  }
  invalidate(): void {
    this.generation++
    this.result = undefined
    this.publish(CHECKING_GAME)
  }
  private publish(status: GameConnectionStatus): void {
    if (!this.active) return
    const previous = this.published
    if (previous?.contextKey === this.contextKey && previous.status.state === status.state && previous.status.detail === status.detail) return
    this.published = { contextKey: this.contextKey, status }
    this.changed(this.published)
  }
  expire(): void {
    this.publish(gameConnection(this.result, this.characterName, this.now()))
  }
  tick(): void {
    if (!this.active) return
    const elapsed = this.now() - this.startedAt
    if (this.pending && overdue(elapsed)) {
      this.timedOut = true
      this.result = READER_UNAVAILABLE
    }
    this.expire()
    void this.read()
  }
  read(): Promise<void> {
    if (!this.active) return Promise.resolve()
    if (this.pending) return this.pending
    const generation = this.generation
    this.startedAt = this.now()
    this.timedOut = false
    const pending = this.request().then(result => {
      if (!this.active || generation !== this.generation) return
      this.result = this.timedOut || overdue(this.now() - this.startedAt) ? READER_UNAVAILABLE : result
      this.expire()
    }).finally(() => { if (this.pending === pending) this.pending = null })
    this.pending = pending
    return pending
  }
  private async request(): Promise<PlayerLocationResult> {
    try { return await this.observe() }
    catch { return READER_UNAVAILABLE }
  }
  dispose(): void { this.active = false; this.generation++; this.result = undefined }
}
