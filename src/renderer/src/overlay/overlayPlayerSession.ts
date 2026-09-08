import type { CharacterRef } from '../../../shared/types'
import type { PlayerLocation, PlayerLocationResult } from '../../../shared/playerLocation'
import { currentPlayerLocation } from '../../../shared/currentPlayer'

export interface OverlayPlayerBridge {
  getCharacter(): Promise<CharacterRef | null>
  getPlayerLocation(): Promise<PlayerLocationResult>
}

/** One observation at a time; character changes invalidate both identity and native replies. */
export class OverlayPlayerSession {
  private character: CharacterRef | null = null
  private generation = 0
  private active = true
  private pending: Promise<void> | null = null
  private result: PlayerLocationResult | undefined

  constructor(private readonly bridge: OverlayPlayerBridge, private readonly changed: (value: PlayerLocation | null) => void,
    private readonly now: () => number = Date.now) {}

  private current(generation: number): boolean { return this.active && generation === this.generation }
  private publish(result?: PlayerLocationResult): void {
    this.result = result
    if (this.active) this.changed(this.character?.name ? currentPlayerLocation(result, this.character.name, this.now()) : null)
  }
  setCharacter(character: CharacterRef | null): void {
    this.generation++
    this.character = character
    this.publish()
    void this.read()
  }
  expire(): void { this.publish(this.result) }

  read(): Promise<void> {
    if (!this.active) return Promise.resolve()
    if (this.pending) return this.pending
    const generation = this.generation
    const pending = this.observe(generation).catch(() => {
      if (this.current(generation)) this.publish()
    }).finally(() => {
      if (this.pending === pending) this.pending = null
      if (this.active && generation !== this.generation) void this.read()
    })
    this.pending = pending
    return pending
  }
  private async observe(generation: number): Promise<void> {
    if (!this.character) {
      const character = await this.bridge.getCharacter()
      if (!this.current(generation)) return
      this.character = character
    }
    if (!this.character?.name) { this.publish(); return }
    const result = await this.bridge.getPlayerLocation()
    if (this.current(generation)) this.publish(result)
  }
  dispose(): void { this.active = false; this.generation++; this.result = undefined }
}
