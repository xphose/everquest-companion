import type { JSX } from 'react'
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import type { QuestJournalDetailResult, QuestJournalRewardComparison } from '@shared/questJournal/journal'
import { ItemWindow } from '../../lib/ItemWindow'
import { formatDateTime } from '../../lib/formatDate'
import type { JournalNavigation } from './navigation'

function Comparison({ comparison, navigation }: { comparison: QuestJournalRewardComparison; navigation: JournalNavigation }): JSX.Element {
  return <Box data-testid="quest-journal-comparison" sx={{ minWidth: 0 }}>
    <Typography variant="subtitle2">{comparison.reward} vs. your {comparison.worn}</Typography>
    <Typography variant="caption" color="text.secondary">{comparison.slot} · {comparison.note}</Typography>
    <Box sx={{ overflowX: 'auto' }}>
      <Table size="small" aria-label={`${comparison.reward} equipment comparison`}>
        <TableHead><TableRow><TableCell>Stat</TableCell><TableCell align="right">Reward</TableCell><TableCell align="right">Equipped</TableCell><TableCell align="right">Change</TableCell></TableRow></TableHead>
        <TableBody>{comparison.stats.map((stat) => <TableRow key={stat.label}>
          <TableCell>{stat.label}</TableCell><TableCell align="right">{stat.reward}</TableCell><TableCell align="right">{stat.worn}</TableCell>
          <TableCell align="right" sx={{ color: stat.delta > 0 ? 'success.main' : stat.delta < 0 ? 'warning.main' : 'text.secondary' }}>{stat.delta > 0 ? '+' : ''}{stat.delta}</TableCell>
        </TableRow>)}</TableBody>
      </Table>
    </Box>
    <Button size="small" onClick={() => navigation.openLoot(comparison.worn)}>Open equipped item</Button>
  </Box>
}

export function JournalRewards({ detail, navigation }: { detail: QuestJournalDetailResult; navigation: JournalNavigation }): JSX.Element {
  return <Stack spacing={1.5} data-testid="quest-journal-rewards">
    <Typography variant="h6">Rewards and equipment</Typography>
    <Typography variant="caption" color="text.secondary">Possible rewards from the source. Several listed items can be alternative outcomes; the list does not promise every item.</Typography>
    {detail.entry?.expReward && <Typography variant="body2">The source records an experience reward.</Typography>}
    {detail.entry?.rewards.map((reward) => <Accordion key={reward.name} disableGutters elevation={0} slotProps={{ transition: { unmountOnExit: true } }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}><Typography variant="subtitle2">{reward.name}</Typography></AccordionSummary>
      <AccordionDetails>
        {reward.stats ? <ItemWindow name={reward.name} stats={reward.stats} compact /> : <Typography variant="body2" color="text.secondary">Item statistics are not recorded.</Typography>}
        <Button size="small" onClick={() => navigation.openLoot(reward.name)}>Open item details</Button>
      </AccordionDetails>
    </Accordion>)}
    {detail.entry?.rewards.length === 0 && <Typography variant="body2" color="text.secondary">No equipment reward is recorded in the bundled source.</Typography>}
    {detail.entry && detail.inventoryRefreshSuggested && <Alert severity="info" sx={{ py: 0 }}>
      Type <code>/outputfile inventory</code> in EverQuest for current item counts and equipment comparisons. This journal reads the updated export automatically.
    </Alert>}
    {detail.entry && <Typography variant="caption" color="text.secondary">
      Inventory: {detail.context.inventory.state}{detail.context.inventory.updatedAt ? ` · ${formatDateTime(Date.parse(detail.context.inventory.updatedAt))}` : ''}.
      {' '}{detail.context.inventory.message}
    </Typography>}
    {detail.comparisons.map((comparison, index) => <Comparison key={`${comparison.reward}:${comparison.slot}:${index}`} comparison={comparison} navigation={navigation} />)}
    {detail.comparisons.length === 0 && <Typography variant="body2" color="text.secondary">
      {detail.context.inventory.state === 'available' ? 'No comparable equipped item is known for these rewards.' : 'An inventory export lets the journal compare rewards with your equipped items.'}
    </Typography>}
  </Stack>
}
