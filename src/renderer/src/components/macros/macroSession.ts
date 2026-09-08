import type { MacroAssistantMutation, MacroAssistantMutationResult, MacroAssistantSnapshot } from '../../../../shared/macroAssistant'
import { installationFeedback, preparationFeedback, type MacroFeedback, type MacroNotice } from './macroFeedback'

export interface MacroBridge {
  getMacroAssistant: () => Promise<MacroAssistantSnapshot>
  mutateMacroAssistant: (mutation: MacroAssistantMutation) => Promise<MacroAssistantMutationResult>
}
export interface MacroSessionState {
  snapshot: MacroAssistantSnapshot | null; error: string | null; busy: boolean
  busyAction?: MacroAssistantMutation['action']; notice?: MacroNotice | null
}
const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error)

function sameInstallation(previous: MacroAssistantSnapshot | null, next: MacroAssistantSnapshot): boolean {
  return previous?.installation.state === next.installation.state &&
    previous?.preparation?.installation?.state === next.preparation?.installation?.state
}
function samePendingPreparation(previous: MacroAssistantSnapshot | null, next: MacroAssistantSnapshot): boolean {
  const before = previous?.preparation?.installation
  return Boolean(before?.packageId && before.state === 'pending' && before.packageId === next.preparation?.installation?.packageId)
}
function preparationNotice(previous: MacroAssistantSnapshot | null, next: MacroAssistantSnapshot, action?: MacroAssistantMutation['action']): MacroFeedback | undefined {
  if (!next.preparation || action === 'configure') return undefined
  if (action === 'prepare') return preparationFeedback(next.preparation)
  const after = next.preparation.installation
  if (!after || !samePendingPreparation(previous, next)) return undefined
  if (after.state === 'conflict' || after.state === 'saved' && after.completion) return preparationFeedback(next.preparation)
  return undefined
}
function preparationStopped(previous: MacroAssistantSnapshot | null, next: MacroAssistantSnapshot): boolean {
  return previous?.preparation?.installation?.state === 'pending' && next.preparation?.installation?.state !== 'pending'
}
function snapshotNotice(previous: MacroAssistantSnapshot | null, next: MacroAssistantSnapshot, action?: MacroAssistantMutation['action']): MacroFeedback | undefined {
  if (action === 'configure') return undefined
  const preparation = preparationNotice(previous, next, action)
  if (preparation || preparationStopped(previous, next)) return preparation
  const completed = previous?.installation.state === 'pending' && next.installation.state !== 'pending' &&
    (next.installation.completion !== undefined || next.installation.state === 'conflict')
  return action === 'queue' || completed ? installationFeedback(next) : undefined
}

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

  private acceptSnapshot(snapshot: MacroAssistantSnapshot, action?: MacroAssistantMutation['action']): Partial<MacroSessionState> {
    const previous = this.state.snapshot?.characterId === snapshot.characterId ? this.state.snapshot : null
    let notice = sameInstallation(previous, snapshot) ? this.state.notice : null
    const feedback = snapshotNotice(previous, snapshot, action)
    if (feedback) notice = { id: ++this.noticeId, feedback }
    return { snapshot, notice }
  }

  private receiveMutation(result: MacroAssistantMutationResult, mutation: MacroAssistantMutation, generation: number): void {
    if (!this.current(generation)) return
    if (result.snapshot.characterId !== mutation.characterId) { this.reset(); return }
    this.errorKind = result.ok ? null : 'mutation'
    const update = result.ok ? this.acceptSnapshot(result.snapshot, mutation.action) : { snapshot: result.snapshot, notice: null }
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
