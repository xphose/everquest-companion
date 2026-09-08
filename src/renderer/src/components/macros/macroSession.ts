import type { MacroAssistantMutation, MacroAssistantMutationResult, MacroAssistantSnapshot } from '../../../../shared/macroAssistant'
import { installationFeedback, type MacroNotice } from './macroFeedback'

export interface MacroBridge {
  getMacroAssistant: () => Promise<MacroAssistantSnapshot>
  mutateMacroAssistant: (mutation: MacroAssistantMutation) => Promise<MacroAssistantMutationResult>
}
export interface MacroSessionState {
  snapshot: MacroAssistantSnapshot | null; error: string | null; busy: boolean
  busyAction?: MacroAssistantMutation['action']; notice?: MacroNotice | null
}
const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error)

/** One request at a time. A queued edit invalidates a pending poll before waiting for it.
 * Character changes and unmounts invalidate both responses and edits not yet sent to main. */
export class MacroSession {
  private state: MacroSessionState = { snapshot: null, error: null, busy: false }
  private generation = 0
  private active = true
  private reading: Promise<void> | null = null
  private errorKind: 'read' | 'mutation' | null = null
  private noticeId = 0

  constructor(private readonly bridge: MacroBridge, private readonly changed: (state: MacroSessionState) => void) {}

  private publish(change: Partial<MacroSessionState>): void {
    this.state = { ...this.state, ...change }
    if (this.active) this.changed(this.state)
  }

  private current(generation: number): boolean { return this.active && generation === this.generation }
  private fail(error: unknown, generation: number, kind: 'read' | 'mutation'): void {
    if (!this.current(generation)) return
    this.errorKind = kind
    this.publish({ error: messageOf(error), notice: null })
  }

  private acceptSnapshot(snapshot: MacroAssistantSnapshot, manualQueue = false): Partial<MacroSessionState> {
    const previous = this.state.snapshot
    const sameCharacter = previous?.characterId === snapshot.characterId
    const prior = previous?.installation.state
    const next = snapshot.installation.state
    let notice = sameCharacter && prior === next ? this.state.notice : null
    const completed = sameCharacter && prior === 'pending' && next !== 'pending' &&
      (snapshot.installation.completion !== undefined || next === 'conflict')
    if (manualQueue || completed) notice = { id: ++this.noticeId, feedback: installationFeedback(snapshot) }
    return { snapshot, notice }
  }

  private receiveMutation(result: MacroAssistantMutationResult, mutation: MacroAssistantMutation, generation: number): void {
    if (!this.current(generation)) return
    if (result.snapshot.characterId !== mutation.characterId) { this.reset(); return }
    this.errorKind = result.ok ? null : 'mutation'
    const update = result.ok ? this.acceptSnapshot(result.snapshot, mutation.action === 'queue') : { snapshot: result.snapshot, notice: null }
    this.publish({ ...update, error: result.ok ? null : result.error ?? 'The change could not be saved.' })
  }

  private canMutate(characterId: string): boolean {
    return this.active && !this.state.busy && this.state.snapshot?.characterId === characterId
  }

  read(clearError = false): Promise<void> {
    if (!this.active || this.state.busy) return Promise.resolve()
    if (this.reading) return this.reading
    if (clearError) { this.errorKind = null; this.publish({ error: null }) }
    const generation = this.generation
    const read = this.bridge.getMacroAssistant().then((snapshot) => {
      if (!this.current(generation)) return
      const update = this.acceptSnapshot(snapshot)
      this.publish({ ...update, notice: this.errorKind === 'mutation' ? null : update.notice,
        error: this.errorKind === 'mutation' ? this.state.error : null })
    }).catch((error: unknown) => {
      this.fail(error, generation, 'read')
    }).finally(() => { if (this.reading === read) this.reading = null })
    this.reading = read
    return read
  }

  async mutate(mutation: MacroAssistantMutation): Promise<void> {
    if (!this.canMutate(mutation.characterId)) return
    const generation = ++this.generation
    this.errorKind = null
    this.publish({ busy: true, busyAction: mutation.action, error: null, notice: null })
    try {
      await this.reading
      if (!this.current(generation)) return
      const result = await this.bridge.mutateMacroAssistant(mutation)
      this.receiveMutation(result, mutation, generation)
    } catch (error) {
      this.fail(error, generation, 'mutation')
    } finally { if (this.active) this.publish({ busy: false, busyAction: undefined }) }
  }

  dismissNotice(id: number): void { if (this.state.notice?.id === id) this.publish({ notice: null }) }
  reset(): void { this.generation++; this.errorKind = null; this.publish({ snapshot: null, error: null, notice: null }) }
  dispose(): void { this.active = false; this.generation++ }
}
