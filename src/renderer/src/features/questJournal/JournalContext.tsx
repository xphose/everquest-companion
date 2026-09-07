import { useState, type JSX } from 'react'
import { Accordion, AccordionDetails, AccordionSummary, Alert, Button, Chip, Stack, TextField, Typography } from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import type { QuestJournalContext } from '@shared/questJournal/journal'
import { formatDateTime } from '../../lib/formatDate'
import type { JournalAction } from './useQuestJournal'
import { QuestRecovery } from './QuestRecovery'

function ProfileCorrection({ context, mutate }: { context: QuestJournalContext; mutate: (action: JournalAction) => Promise<void> }): JSX.Element {
  const [level, setLevel] = useState(context.level?.toString() ?? '')
  const [classes, setClasses] = useState(context.classes.join(', '))
  const save = (): void => {
    const parsedLevel = Number(level)
    void mutate({ action: 'profile', level: level && Number.isFinite(parsedLevel) ? parsedLevel : undefined,
      classes: classes.split(',').map((name) => name.trim()).filter(Boolean) })
  }
  return (
    <Accordion disableGutters elevation={0} sx={{ bgcolor: 'transparent', '&:before': { display: 'none' } }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0, minHeight: 32 }} data-testid="quest-journal-profile-toggle">
        <Typography variant="caption">Character details and profile correction</Typography>
      </AccordionSummary>
      <AccordionDetails sx={{ px: 0, pt: 0 }}>
        <Stack spacing={1}>
          <Typography variant="caption" color="text.secondary">Profile: {context.profileSource}. Quest levels describe where a quest starts; enemy levels and equipment requirements can differ.</Typography>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            <TextField size="small" type="number" label="Character level" value={level} sx={{ width: 130 }}
              slotProps={{ htmlInput: { min: 1, max: 125 } }} onChange={(event) => setLevel(event.target.value)} />
            <TextField size="small" label="Classes, separated by commas" value={classes} sx={{ flex: '1 1 230px' }}
              onChange={(event) => setClasses(event.target.value)} />
            <Button size="small" disabled={!context.characterId} onClick={save}>Save correction</Button>
            <Button size="small" disabled={!context.characterId} onClick={() => void mutate({ action: 'profile', classes: [] })}>Use detected profile</Button>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            Inventory: {context.inventory.state}{context.inventory.updatedAt ? ` · ${formatDateTime(Date.parse(context.inventory.updatedAt))}` : ''}.
            {' '}Achievements: {context.achievements.state}{context.achievements.updatedAt ? ` · ${formatDateTime(Date.parse(context.achievements.updatedAt))}` : ''}.
          </Typography>
        </Stack>
      </AccordionDetails>
    </Accordion>
  )
}

export function JournalContext({ context, refresh, mutate }: {
  context: QuestJournalContext; refresh: () => void; mutate: (action: JournalAction) => Promise<void>
}): JSX.Element {
  return (
    <Stack spacing={0.5} data-testid="quest-journal-context">
      <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
        <Typography variant="h5" sx={{ flexGrow: 1 }}>Quest journal</Typography>
        <Chip size="small" label={context.characterName ?? 'Browse quest catalog'} />
        {context.level !== undefined && <Chip size="small" variant="outlined" label={`Level ${context.level}`} />}
        {context.classes.map((name) => <Chip key={name} size="small" variant="outlined" label={name} />)}
        <QuestRecovery characterId={context.characterId} characterName={context.characterName} characterServer={context.characterServer} refresh={refresh} />
        <Button size="small" onClick={refresh} data-testid="quest-journal-refresh">Refresh</Button>
      </Stack>
      <Typography variant="body2" color="text.secondary">
        {context.characterId ? 'Progress updates from your game log and character exports.' : 'Explore quests now. Select a character log to see your progress and equipment comparisons.'}
        {context.zone ? ` Current zone: ${context.zone}.` : ''}
      </Typography>
      {context.message && <Alert severity="info" sx={{ py: 0 }}>{context.message}</Alert>}
      {context.tasksTruncated && <Alert severity="info" sx={{ py: 0 }}>The log contains more task names than this journal can retain; some tasks are missing.</Alert>}
      <ProfileCorrection context={context} mutate={mutate} />
    </Stack>
  )
}
