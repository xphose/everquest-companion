import type { JSX } from 'react'
import { Box } from '@mui/material'
import type { CharacterRef } from '@shared/types'
import { GAME_DEPENDENCIES, type GameConnectionStatus as ConnectionStatus } from '@shared/gameConnection'
import { useGameConnection } from '../lib/useGameConnection'

const COMPACT_LABEL: Record<ConnectionStatus['state'], string> = {
  checking: 'Checking', closed: 'Closed', waiting: 'Running', connected: 'In game',
  'other-character': 'Other', unsupported: 'Limited', ambiguous: 'Multiple', unknown: 'Unknown'
}

export default function GameConnectionStatus({ character }: { character: CharacterRef | null }): JSX.Element {
  const status = useGameConnection(character)
  return (
    <Box data-no-drag data-testid="game-connection" data-state={status.state}
      role="status" aria-live="polite" aria-label={status.label}
      title={`${status.label}: ${status.detail}\n\n${GAME_DEPENDENCIES}`}
      sx={{ WebkitAppRegion: 'no-drag', display: 'flex', alignItems: 'center', gap: 0.75,
        width: 146, minWidth: 14, flexShrink: 1, fontSize: 11, whiteSpace: 'nowrap', color: 'text.secondary',
        '& .game-connection-short': { display: 'none' },
        '@media (max-width: 1100px)': { width: 64, '& .game-connection-long': { display: 'none' }, '& .game-connection-short': { display: 'inline' } } }}>
      <Box component="span" aria-hidden="true" sx={{ width: 7, height: 7, flexShrink: 0, borderRadius: '50%',
        bgcolor: status.tone === 'neutral' ? 'text.disabled' : `${status.tone}.main` }} />
      <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
        <span className="game-connection-long">{status.label}</span>
        <span className="game-connection-short">{COMPACT_LABEL[status.state]}</span>
      </Box>
    </Box>
  )
}
