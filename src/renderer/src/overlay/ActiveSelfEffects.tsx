import type { JSX } from 'react'
import type { ActiveEffectRow } from '../../../shared/activeBuffs'

export interface ActiveSelfEffectsModel { live: boolean; rows: ActiveEffectRow[]; hidden: number }

/** Current native effects are neutral: their presence does not prove beneficialness or a caster. */
export function ActiveSelfEffects({ model }: { model: ActiveSelfEffectsModel }): JSX.Element {
  return <section data-testid="active-self-effects" data-source={model.live ? 'live' : 'log'} style={{ padding: '4px 2px 7px' }}>
    <div style={{ fontSize: 10, color: model.live ? '#8bd6aa' : 'rgba(255,255,255,0.6)', padding: '2px 2px 5px' }}>
      {model.live ? 'Active effects on you · Live' : 'Live effects unavailable · Showing logged timers'}
    </div>
    {model.live && model.rows.length === 0 && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', padding: '4px 2px' }}>
      {model.hidden ? 'Active effects are hidden by your tracking choices.' : 'No active effects on you.'}
    </div>}
    {model.rows.map((row) => <div key={row.id} data-testid="active-self-effect" data-spell-id={row.spellId}
      style={{ display: 'flex', gap: 8, padding: '5px 7px', marginBottom: 3, background: 'rgba(112,166,133,0.13)', borderLeft: '2px solid #7bac90', borderRadius: 3 }}>
      <span style={{ flex: 1, minWidth: 0, fontSize: 11, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{row.name}</span>
      {row.kind === 'song' && <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.55)' }}>song</span>}
      <span style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: '#b9d9c6' }}>{row.time}</span>
    </div>)}
  </section>
}
