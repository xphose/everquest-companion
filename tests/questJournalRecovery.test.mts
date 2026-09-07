import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ProgressState } from '../src/shared/types.ts'
import type { QuestJournalCatalogEntry } from '../src/shared/questJournal/catalog.ts'
import type { RecoveryCapture, RecoveryDraft, RecoveryRecord } from '../src/shared/questJournal/recovery.ts'
import { classUnlockClaims, parseAchievementsDump } from '../src/shared/outputs/achievements.ts'
import { createRecoveryService, type RecoveryServiceDeps } from '../src/main/questJournal/recovery/service.ts'
import { screenCandidates } from '../src/main/questJournal/recovery/screen.ts'
import { npcJournalScan, npcJournalStatus } from '../src/main/questJournal/recovery/npcJournal.ts'
import { sanitizeRecovery } from '../src/main/questJournal/recovery/records.ts'
import { createQuestJournalService, type JournalWorld } from '../src/main/questJournal/service.ts'
import { detailJournal, queryJournal, type JournalModelInput } from '../src/main/questJournal/model.ts'
import { sanitizeProgress } from '../src/main/questJournal/validate.ts'
import type { JournalFiles } from '../src/main/questJournal/files.ts'

const source = { url: 'https://example.test/quest', snapshotAt: '2026-09-06' }
function quest(name = 'Ranger Test of Defense'): QuestJournalCatalogEntry {
  return { id: `posky:Ranger::${name}`, name, page: name, source, classes: ['Ranger'], relatedZones: [], expReward: false,
    pickupLocations: [], relatedNpcs: [], referencedItems: [], rewards: [{ name: 'Dark Cloak of the Sky', sourceUrl: source.url }] }
}
const entry = quest()

function setup(catalog = [entry]) {
  let now = 1000000
  let world: JournalWorld = { characterId: 'ada_test', character: { name: 'Ada', server: 'test', logPath: 'C:/test/eqlog_Ada_test.txt' }, token: 'one', readiness: 'unavailable' }
  let progress: ProgressState = { inventory: {}, completedQuests: [] }
  const files: JournalFiles = { inventoryStatus: { state: 'missing' }, achievementsStatus: { state: 'missing' }, inventory: null, claims: [], worn: [] }
  let writes = 0
  const deps: RecoveryServiceDeps = { world: () => world, catalog: () => catalog, files: () => files,
    snapshot: () => Promise.reject(new Error('No engine')), getProgress: () => progress,
    setProgress: (_id, value) => { progress = value; writes++ }, now: () => now, root: () => join(tmpdir(), 'quest-recovery-missing-test-root') }
  return { deps, files, service: createRecoveryService(deps), get progress() { return progress }, set progress(value) { progress = value },
    get writes() { return writes }, setWorld: (value: Partial<JournalWorld>) => { world = { ...world, ...value } }, advance: () => { now += 600000 } }
}

async function scan(harness: ReturnType<typeof setup>, capture?: RecoveryCapture): Promise<RecoveryDraft> {
  const result = await harness.service.scan({ characterId: 'ada_test', source: capture ? 'clipboard' : 'files' }, capture)
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error(result.error)
  return result.draft
}

function request(draft: RecoveryDraft, ids = draft.candidates.map((row) => row.id)) {
  return { action: 'apply' as const, characterId: draft.characterId, draftId: draft.id, candidateIds: ids, confirmedCharacter: true }
}

/** Synthetic text with table labels verified in EQUI_TaskWnd.xml; this is not a recorded game image. */
function table(name = entry.name, history = false): RecoveryCapture {
  return { text: ['Current Tasks', 'Shared Task', 'Quest History',
    history ? 'Quest Title\tCompletion' : 'Task Title\tTime Left', name,
    history ? 'Quest Progression' : 'Task Progression'].join('\n') }
}

test('no evidence produces no completions and explicitly reports each unavailable file source', async () => {
  const h = setup()
  const draft = await scan(h)
  assert.equal(draft.candidates.length, 0)
  assert.equal(draft.sources.length, 3)
  assert.ok(draft.sources.every((status) => status.state === 'missing'))
  assert.equal((await h.service.commit(request(draft))).ok, false)
  assert.equal(h.writes, 0)
})

test('real achievement export recovery accepts earned rewards and excludes class-bypass grants', async () => {
  const paladin = { ...quest('Paladin Test of Love'), id: 'posky:Paladin::Paladin Test of Love', classes: ['Paladin'], rewards: [{ name: 'Ardent', sourceUrl: source.url }] }
  const h = setup([entry, paladin])
  h.files.claims = classUnlockClaims(parseAchievementsDump(readFileSync(new URL('./fixtures/Primitive_freeport-Achievements.txt', import.meta.url), 'utf8')))
  h.files.achievementsStatus = { state: 'available' }
  const draft = await scan(h)
  assert.deepEqual(draft.candidates.map((row) => [row.questId, row.state, row.selectedByDefault]), [[entry.id, 'completed', true]])
  assert.equal((await h.service.commit(request(draft))).ok, true)
  assert.equal(h.progress.questJournal?.recovery?.[entry.id].source, 'achievement')
  assert.equal(h.progress.questJournal?.quests[entry.id], undefined)
})

test('reward possession is an unselected suggestion requiring explicit confirmation, separate from manual flags', async () => {
  const h = setup()
  h.files.inventory = { 'dark cloak of the sky': 1 }
  h.files.inventoryStatus = { state: 'available' }
  h.progress.questJournal = { version: 1, quests: { [entry.id]: { status: 'active', tracked: true, steps: {} } } }
  const draft = await scan(h)
  assert.equal(draft.candidates[0].selectedByDefault, false)
  assert.equal(draft.candidates[0].confidence, 'likely')
  assert.equal((await h.service.commit({ ...request(draft), confirmedCharacter: false })).ok, false)
  assert.equal(h.writes, 0)
  assert.equal((await h.service.commit(request(draft))).ok, true)
  assert.equal(h.progress.questJournal?.recovery?.[entry.id].confidence, 'user-confirmed')
  assert.equal(h.progress.questJournal?.quests[entry.id].status, 'active')
})

test('opaque draft selection rejects forged IDs, ignores renderer candidate edits, and applies only once', async () => {
  const h = setup()
  const draft = await scan(h, table())
  assert.equal((await h.service.commit(request(draft, ['forged']))).ok, false)
  assert.equal((await h.service.commit(request(draft, ['__proto__']))).ok, false)
  draft.candidates[0].state = 'completed'
  assert.equal((await h.service.commit(request(draft))).ok, true)
  assert.equal(h.progress.questJournal?.recovery?.[entry.id].state, 'active')
  assert.equal((await h.service.commit(request(draft))).ok, false)
  assert.equal(h.writes, 1)
})

test('expired drafts, changed characters, and replacement engine epochs cannot write', async () => {
  const expired = setup(); const draft = await scan(expired, table())
  expired.advance()
  assert.equal((await expired.service.commit(request(draft))).ok, false)
  const changed = setup(); const second = await scan(changed, table())
  changed.setWorld({ characterId: 'other_test' })
  assert.equal((await changed.service.commit(request(second))).ok, false)
  changed.setWorld({ characterId: 'ada_test', token: 'new-epoch' })
  assert.equal((await changed.service.commit(request(second))).ok, false)
  assert.equal(changed.writes + expired.writes, 0)
  changed.setWorld({ characterId: null, character: null })
  assert.equal((await changed.service.scan({ characterId: 'none', source: 'files' })).ok, false)
})

test('commit merges the latest per-character progress and forgetting recovery preserves manual and legacy fields', async () => {
  const h = setup(); const draft = await scan(h, table())
  h.progress = { inventory: { token: 2 }, completedQuests: ['legacy'], questJournal: {
    version: 1, quests: { other: { status: 'active', tracked: true, steps: {} } }, profile: { level: 42, classes: ['Ranger'] } } }
  assert.equal((await h.service.commit(request(draft))).ok, true)
  assert.deepEqual(h.progress.inventory, { token: 2 })
  assert.deepEqual(h.progress.completedQuests, ['legacy'])
  assert.equal(h.progress.questJournal?.profile?.level, 42)
  assert.equal(h.progress.questJournal?.quests.other.status, 'active')
  assert.deepEqual(await h.service.commit({ action: 'forget', characterId: 'ada_test', questId: entry.id }), { ok: true, applied: 1 })
  assert.deepEqual(h.progress.questJournal?.recovery, {})
  assert.equal(h.progress.questJournal?.quests.other.tracked, true)
})

test('history imports preserve an already recovered active repeat and warn when the scan contains both states', async () => {
  const h = setup()
  h.files.claims = classUnlockClaims(parseAchievementsDump(readFileSync(new URL('./fixtures/Primitive_freeport-Achievements.txt', import.meta.url), 'utf8')))
  const both = await scan(h, table())
  assert.equal(both.candidates.length, 2)
  assert.ok(both.warnings.some((warning) => warning.includes('Both active and historical')))
  assert.equal((await h.service.commit(request(both))).ok, true)
  assert.equal(h.progress.questJournal?.recovery?.[entry.id].state, 'active')
  const history = await scan(h, table(entry.name, true))
  assert.equal((await h.service.commit(request(history))).ok, true)
  assert.equal(h.progress.questJournal?.recovery?.[entry.id].state, 'active')
})

test('page identity comes from table interiors; visible tabs and prose never imply completion', () => {
  const active = screenCandidates([entry], table())
  assert.equal(active.candidates[0].state, 'active')
  const history = screenCandidates([entry], table(entry.name, true))
  assert.equal(history.candidates[0].state, 'completed')
  const tabsOnly = screenCandidates([entry], { text: `Current Tasks\nQuest History\n${entry.name}` })
  assert.equal(tabsOnly.candidates.length, 0)
  const dialogue = screenCandidates([entry], table(`The quest ${entry.name} is complete.`))
  assert.equal(dialogue.candidates.length, 0)
  assert.ok(dialogue.warnings.length)
  const ambiguous = screenCandidates([entry], { text: table().text + '\nQuest Title\nCompletion' })
  assert.equal(ambiguous.candidates.length, 0)
  assert.equal(screenCandidates([entry, { ...entry, id: 'duplicate' }], table()).candidates.length, 0)
})

test('plain text unknown rows need clear cell boundaries; objectives need a selected task association', () => {
  assert.equal(screenCandidates([], table('Unmatched text')).candidates.length, 0)
  const bounded = screenCandidates([], table('Unknown Weekly Task\t00:10:00'))
  assert.equal(bounded.candidates[0].questId, 'task:unknown weekly task')
  assert.equal(bounded.candidates[0].selectedByDefault, false)
  assert.equal(bounded.candidates[0].confidence, 'likely')
  assert.ok(bounded.warnings.some((warning) => warning.includes('No guide matches')))
  const objectives = '\nObjective Instructions\tStatus\tZone\nDefeat foes\t2/4\tBlackburrow'
  const ambiguous = screenCandidates([entry], { text: table().text + objectives })
  assert.equal(ambiguous.candidates[0].objectives, undefined)
  assert.equal(ambiguous.unassignedObjectives?.[0].current, 2)
  const selected = screenCandidates([entry], { text: table().text + `\n${entry.name}${objectives}` })
  assert.deepEqual(selected.candidates[0].objectives, [{ text: 'Defeat foes', current: 2, required: 4, complete: false }])
})

test('spatial OCR extracts full title-column rows without timers, zones, or later description text', () => {
  const line = (text: string, y: number, x = 20) => ({ text, words: text.split(' ').map((word, index) => ({ text: word, x: x + index * 42, y, width: 40, height: 12 })) })
  const lines = [line('Current Tasks Shared Task Quest History', 10), line('Task Title', 40), line('Time Left', 40, 420),
    line(entry.name, 70), line('00:10:00', 70, 420), line('Unknown Weekly Task', 90), line('Task Progression', 140), line('Description', 170), line(entry.name, 190)]
  const result = screenCandidates([entry], { text: lines.map((row) => row.text).join('\n'), lines })
  assert.deepEqual(result.candidates.map((row) => row.name), [entry.name, 'Unknown Weekly Task'])
})

function model(recovery: RecoveryRecord): JournalModelInput {
  return { catalog: [entry], progress: { version: 1, quests: {}, recovery: { [entry.id]: recovery } }, inventory: null,
    observed: [], claims: [], worn: [], turnins: [], completedSky: new Set(),
    context: { characterId: 'ada_test', classes: [], profileSource: 'unknown', readiness: 'unavailable', inventory: { state: 'missing' }, achievements: { state: 'missing' }, refreshedAt: 1000, tasksTruncated: false } }
}
function recovered(state: 'active' | 'completed', source: RecoveryRecord['source'] = 'task-window'): RecoveryRecord {
  return { questId: entry.id, name: entry.name, state, source, confidence: 'confirmed', recoveredAt: 2000, evidence: ['Visible task table'] }
}

test('recovered baselines survive missing engine data while manual corrections and later log events take precedence', () => {
  const input = model(recovered('active'))
  input.observed = [{ name: entry.name, cycleStatus: 'completed', completedAt: 1000, lastObservedAt: 1000 }]
  assert.equal(detailJournal(input, entry.id).row?.state, 'active')
  input.observed[0].lastObservedAt = 3000
  assert.equal(detailJournal(input, entry.id).row?.state, 'completed')
  input.progress.quests[entry.id] = { status: 'active', steps: {} }
  assert.equal(detailJournal(input, entry.id).row?.state, 'active')
  input.progress.quests = {}
  input.progress.recovery = { [entry.id]: recovered('completed', 'history-window') }
  input.observed = [{ name: entry.name, cycleStatus: 'assigned', assignedAt: 1000 }]
  assert.equal(detailJournal(input, entry.id).row?.state, 'active')
  input.progress.recovery[entry.id].source = 'achievement'
  assert.equal(detailJournal(input, entry.id).row?.state, 'active')
})

test('restart sanitization preserves valid recovery and rejects malformed IDs, sources, dates and objectives', async () => {
  const good = recovered('completed', 'history-window')
  const rows = { [entry.id]: good, forged: { ...good, questId: 'forged', source: 'dialogue-implies-done' }, badDate: { ...good, questId: 'badDate', recoveredAt: NaN } }
  assert.deepEqual(Object.keys(sanitizeRecovery(rows)), [entry.id])
  assert.deepEqual(sanitizeRecovery(JSON.parse('{"__proto__":{"questId":"__proto__"}}')), {})
  const h = setup()
  h.progress.questJournal = sanitizeProgress(JSON.parse(JSON.stringify({ version: 1, quests: {}, recovery: rows })))
  const restarted = createQuestJournalService(h.deps)
  const detail = await restarted.detail({ characterId: 'ada_test', id: entry.id })
  assert.equal(detail.row?.state, 'completed')
  assert.equal(detail.recovered?.recoveredAt, 2000)
  assert.ok(detail.evidence.some((line) => line.includes('import time, not a quest event date')))
  const input = model({ ...good, questId: 'task:unknown weekly', name: 'Unknown Weekly' })
  input.progress.recovery = { 'task:unknown weekly': { ...good, questId: 'task:unknown weekly', name: 'Unknown Weekly' } }
  assert.equal(queryJournal(input, { search: 'Unknown Weekly' }).rows[0].state, 'completed')
})

test('NPC journal discovery requires the exact character and server and never parses invented record syntax', () => {
  const directory = mkdtempSync(join(tmpdir(), 'quest-recovery-npc-'))
  const character = { name: 'Ada', server: 'test', logPath: 'log' }
  try {
    mkdirSync(join(directory, 'userdata'))
    writeFileSync(join(directory, 'userdata', 'CJ_Other_test.txt'), 'Quest completed!')
    assert.equal(npcJournalStatus(directory, character).state, 'missing')
    writeFileSync(join(directory, 'userdata', 'CJ_Ada_test.txt'), 'Synthetic unsupported data, not a real saved NPC journal fixture.')
    const status = npcJournalStatus(directory, character)
    assert.equal(status.state, 'available')
    assert.match(status.message, /unverified/u)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('long unique quoted phrases offer optional CJ reference clues across supported text encodings', () => {
  const directory = mkdtempSync(join(tmpdir(), 'quest-recovery-quote-'))
  const phrase = 'Bring the ancient casks from the forgotten brewery back to the waiting master when your journey through the caverns is complete.'
  const clue = { ...entry, walkthrough: [{ text: `The keeper says, "${phrase}"` }] }
  const character = { name: 'Ada', server: 'test', logPath: 'log' }
  try {
    mkdirSync(join(directory, 'userdata'))
    const path = join(directory, 'userdata', 'CJ_Ada_test.txt')
    // These byte sequences exercise decoding and matching only, not a claimed CJ record format.
    for (const bytes of [Buffer.from(phrase), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(phrase, 'utf16le')]), Buffer.concat([Buffer.from([0xe9, 32]), Buffer.from(phrase)])]) {
      writeFileSync(path, bytes)
      const scanned = npcJournalScan(directory, character, [clue])
      assert.equal(scanned.candidates[0].confidence, 'likely')
      assert.equal(scanned.candidates[0].selectedByDefault, false)
      assert.equal(scanned.candidates[0].source, 'npc-journal')
    }
    assert.equal(npcJournalScan(directory, character, [clue, { ...clue, id: 'other' }]).candidates.length, 0)
    writeFileSync(path, Buffer.from([0, 1, 2, 3]))
    assert.equal(npcJournalScan(directory, character, [clue]).status.state, 'error')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('held verified ingredients are optional active suggestions while ambiguous variants remain excluded', async () => {
  const guide = { source, notes: [], steps: [{ id: 'collect', kind: 'collect' as const, text: 'Collect casks', locations: [],
    items: [{ name: 'Cask', quantity: 3 }], manualOnly: false }] }
  const h = setup([{ ...entry, guide }, { ...entry, id: 'other', guide }])
  h.files.inventory = { cask: 2 }
  const draft = await scan(h)
  assert.equal(draft.candidates.length, 2)
  assert.ok(draft.candidates.every((row) => row.state === 'active' && !row.selectedByDefault))
  assert.ok(draft.candidates[0].evidence.some((line) => line.includes('2 × Cask')))
  assert.ok(draft.candidates[0].evidence.some((line) => line.includes('other quest')))
  const variant = { ...guide, steps: [{ ...guide.steps[0], items: [{ name: 'Cask', quantity: 3, variant: 'Distinct rune' }] }] }
  const ambiguous = setup([{ ...entry, guide: variant }]); ambiguous.files.inventory = { cask: 2 }
  assert.equal((await scan(ambiguous)).candidates.length, 0)
})

test('objective association accepts only a selected active screenshot candidate and never renderer-supplied counts', async () => {
  const h = setup()
  const draft = await scan(h, { text: table().text + '\nObjective Instructions\tStatus\tZone\nCollect casks\t2/3\tBlackburrow' })
  assert.deepEqual(draft.objectiveCandidates, [{ id: draft.candidates[0].id, name: entry.name }])
  assert.equal((await h.service.commit({ ...request(draft), objectiveCandidateId: 'forged' })).ok, false)
  if (!draft.unassignedObjectives) throw new Error('Missing objective preview')
  draft.unassignedObjectives[0].current = 999
  assert.equal((await h.service.commit({ ...request(draft), objectiveCandidateId: draft.candidates[0].id })).ok, true)
  const record = h.progress.questJournal?.recovery?.[entry.id]
  assert.equal(record?.objectives?.[0].current, 2)
  assert.ok(record?.evidence.some((line) => line.includes('You associated')))
  const current = await createQuestJournalService(h.deps).detail({ characterId: 'ada_test', id: entry.id })
  assert.match(current.nextStep ?? '', /Collect casks \(2\/3\)/u)
})

test('captured time precedes review and a newer log completion supersedes the active recovery baseline', async () => {
  const h = setup()
  const draft = await scan(h, { ...table(), capturedAt: 900000 })
  assert.equal((await h.service.commit(request(draft))).ok, true)
  const record = h.progress.questJournal?.recovery?.[entry.id]
  assert.equal(record?.recoveredAt, 900000)
  if (!record) throw new Error('No recovery saved')
  const input = model(record)
  input.observed = [{ name: entry.name, cycleStatus: 'completed', lastObservedAt: 950000 }]
  assert.equal(detailJournal(input, entry.id).row?.state, 'completed')
})

test('applying or forgetting a recovery invalidates earlier previews for that character', async () => {
  const h = setup()
  const first = await scan(h, table()); const second = await scan(h, table(entry.name, true))
  assert.equal((await h.service.commit(request(second))).ok, true)
  assert.equal((await h.service.commit(request(first))).ok, false)
  const third = await scan(h, table())
  assert.equal((await h.service.commit({ action: 'forget', characterId: 'ada_test' })).ok, true)
  assert.equal((await h.service.commit(request(third))).ok, false)
})

test('column-grouped OCR lines preserve task titles and separate objective ratios from zone names', () => {
  const line = (text: string, x: number, y: number) => ({ text, words: text.split(' ').map((word, index) => ({ text: word, x: x + index * 50, y, width: 48, height: 12 })) })
  const lines = [line('Task Title', 20, 40), line(entry.name, 20, 70), line('Task Progression', 20, 150),
    line('Objective Instructions', 20, 180), line('Collect casks', 20, 220), line('Time Left', 420, 40),
    line('Zone', 600, 40), line('Status', 420, 180), line('2/3', 420, 220), line('Zone', 600, 180), line('Blackburrow', 600, 220)]
  const split = lines.flatMap((row) => row.words.map((word) => ({ text: word.text, words: [word] })))
  const result = screenCandidates([entry], { text: lines.map((row) => row.text).join('\n'), lines: split })
  assert.equal(result.candidates[0].name, entry.name)
  assert.deepEqual(result.unassignedObjectives, [{ text: 'Collect casks', current: 2, required: 3, complete: false }])
  // The real Windows OCR smoke omitted a visible 2/3 cell entirely. Preserve the label, not a guessed ratio.
  const missingStatus = split.filter((row) => row.text !== '2/3')
  const unknown = screenCandidates([entry], { text: missingStatus.map((row) => row.text).join('\n'), lines: missingStatus })
  assert.deepEqual(unknown.unassignedObjectives, [{ text: 'Collect casks' }])
  assert.ok(unknown.warnings.some((warning) => warning.includes('progress unknown')))
  const overlapping = { text: 'unreadable', words: [{ text: 'unreadable', x: 420, y: 280, width: 300, height: 12 }] }
  const narrative = [...missingStatus, line('Narrative fragment', 20, 250), line('not a status', 420, 250), line('Blackburrow', 600, 250),
    line('Chat without zone', 20, 270), line('Overlapping status', 20, 280), overlapping, line('Blackburrow', 600, 280),
    line('Chat after table', 20, 500), line('Blackburrow', 600, 500)]
  const bounded = screenCandidates([entry], { text: narrative.map((row) => row.text).join('\n'), lines: narrative })
  assert.deepEqual(bounded.unassignedObjectives, [{ text: 'Collect casks' }])
})
