import type { GearProgressionContext } from '@shared/gearProgression'

export interface GearCharacterReading { context: GearProgressionContext | null; pending: boolean; error: string | null }
interface Pending { generation: number; started: number; expired: boolean }
interface SessionDeps { read: () => Promise<GearProgressionContext>; publish: (state: GearCharacterReading) => void; checked?: (at: number | null) => void; now?: () => number }
const WAIT_LIMIT = 12_000
const LIVE_LIMIT = 6_000

/** Ignore a timestamp tick while still checking its freshness on every completion and timer tick. */
function semanticContext(context: GearProgressionContext): string {
  const { sampledAt: _sampledAt, ...facts } = context
  return JSON.stringify(facts)
}

/** Single-flight polling with explicit character-generation and timeout recovery. */
export function gearProgressionSession(deps: SessionDeps): { tick: () => void; refresh: () => void; invalidate: (characterId?: string | null) => void; stop: () => void } {
  const now = deps.now ?? Date.now
  let alive = true
  let generation = 0
  let pending: Pending | null = null
  let again = false
  let signature = ''
  let last: GearProgressionContext | null = null
  const fail = (message: string): void => {
    signature = ''
    last = null
    deps.publish({ context: null, pending: false, error: message })
  }
  const accept = (context: GearProgressionContext, own: Pending): void => {
    if (!alive || own.generation !== generation || own.expired) return
    if (now() - own.started >= WAIT_LIMIT) { own.expired = true; fail('Reading your character took too long. Retrying automatically.'); return }
    if (context.source === 'live' && !fresh(context, now())) { fail('Waiting for a fresh reading of your character.'); return }
    last = context
    deps.checked?.(now())
    const next = semanticContext(context)
    if (next !== signature) { signature = next; deps.publish({ context, pending: false, error: null }) }
  }
  const tick = (): void => {
    if (!alive) return
    if (last?.source === 'live' && !fresh(last, now())) fail('Waiting for a fresh reading of your character.')
    if (pending) {
      if (!pending.expired && pending.generation === generation && now() - pending.started >= WAIT_LIMIT) {
        pending.expired = true
        fail('Reading your character is taking longer than expected. Retrying automatically.')
      }
      return
    }
    const own: Pending = { generation, started: now(), expired: false }
    pending = own
    void deps.read().then(context => accept(context, own)).catch(() => {
      if (alive && own.generation === generation) fail('Your character could not be read. Retrying automatically.')
    }).finally(() => { pending = null; if (again && alive) { again = false; tick() } })
  }
  const refresh = (): void => { if (pending) again = true; else tick() }
  return { tick, refresh, invalidate: characterId => {
    generation++
    if (characterId === undefined || characterId !== last?.characterId) {
      signature = ''
      last = null
      deps.checked?.(null)
      deps.publish({ context: null, pending: true, error: null })
    }
    refresh()
  }, stop: () => { alive = false; generation++ } }
}

function fresh(context: GearProgressionContext, now: number): boolean {
  const age = now - (context.sampledAt ?? NaN)
  return Number.isFinite(age) && age >= 0 && age <= LIVE_LIMIT
}
