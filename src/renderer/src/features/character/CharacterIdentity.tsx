// character/CharacterIdentity — who this sheet is about.
//
// THREE FACTS, THREE SOURCES, AND EACH ONE IS ALLOWED TO BE ABSENT.
//   * NAME + SERVER — the `character` module, i.e. the log file being tailed. Always known
//     when there is a log at all.
//   * LEVEL + CLASSES — the current matching game observation, supplied by useCurrentClasses.
//     Native classes are an active set, never a claim about class slot order. When the game
//     cannot supply either fact, that fact falls back independently to the log and says so.
//     Logged classes retain their original slot ambiguity and provenance; historical intervals
//     and user corrections are not rewritten by a current observation.
//
// The dump itself carries none of this: it has no header, no preamble and no character
// metadata — the name and server appear only in its FILENAME (JOS-45 spike, confirmed against
// the client binary). So nothing here reads the sheet.

import type { JSX } from 'react'
import { Chip, Stack, Typography } from '@mui/material'
import type { CharacterSnap, ProgressionSnap } from '@shared/types'
import type { CurrentClasses } from '@shared/currentClasses'
import { currentLevelRead, type CurrentLevelRead } from '@shared/currentLevel'
import { Tooltip } from '../../lib/Tooltip'
import { useModule } from '../../lib/useModule'
import { EMPTY_PROGRESSION } from '../leveling/progressionDelta'
import { ProvenanceChip, SlotChips } from '../profiles/ClassComboChips'
import { useCurrentClasses } from '../../lib/useCurrentClasses'

function identityLevel(logged: CurrentLevelRead | null, live: number | undefined): Pick<CurrentLevelRead, 'level' | 'cue' | 'title'> | null {
  if (live !== undefined) return { level: live, cue: 'Live', title: 'Current level read from the active game character.' }
  return logged && { ...logged, cue: `From log${logged.cue ? ` · ${logged.cue}` : ''}` }
}

function IdentityClasses({ current }: { current: CurrentClasses }): JSX.Element {
  if (current.source === 'live') return (
    <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap data-testid="character-live-classes">
      {current.classes.map((cls) => <Chip key={cls} size="small" label={cls} variant="outlined" />)}
      <Chip size="small" label="Live classes" color="success" variant="outlined"
        title="Current selected classes read from the game; their order does not identify class slots." />
    </Stack>
  )
  if (current.logged) return (
    <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
      <SlotChips slots={current.logged.slots} />
      <ProvenanceChip interval={current.logged} />
    </Stack>
  )
  return (
    <Typography variant="caption" color="text.disabled">
      No loadout read yet - one appears as soon as the game or log names classes you played.
    </Typography>
  )
}

export default function CharacterIdentity(): JSX.Element {
  const who = useModule<CharacterSnap>('character')
  const prog = useModule<ProgressionSnap>('progression')
  const current = useCurrentClasses()

  const character = who?.character ?? null
  // The progression snapshot supplies the LOG CLOCK the statement's age is measured against (and
  // the ding-tail fallback for the frame before the character module hydrates) — never the wall
  // clock, which would call a freshly-loaded log three weeks stale.
  const loggedLevel = currentLevelRead(who?.level, prog ?? EMPTY_PROGRESSION)
  const level = identityLevel(loggedLevel, current.liveLevel)

  return (
    <Stack
      direction="row"
      spacing={1.25}
      alignItems="baseline"
      flexWrap="wrap"
      useFlexGap
      sx={{ minWidth: 0 }}
      data-testid="character-identity"
    >
      <Typography variant="h6" sx={{ lineHeight: 1.2 }}>
        {character?.name ?? 'No character'}
      </Typography>
      {character && (
        <Typography variant="caption" color="text.disabled">
          {character.server}
        </Typography>
      )}
      {level && (
        <Tooltip title={level.title}>
          <Typography variant="subtitle2" color="text.secondary" data-testid="character-level">
            Level {level.level}
            {level.cue && (
              <Typography component="span" variant="caption" color="text.disabled" sx={{ ml: 0.5 }}>
                {level.cue}
              </Typography>
            )}
          </Typography>
        </Tooltip>
      )}
      <IdentityClasses current={current} />
    </Stack>
  )
}
