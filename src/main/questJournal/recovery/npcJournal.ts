import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { CharacterRef } from '../../../shared/types'
import type { QuestJournalCatalogEntry } from '../../../shared/questJournal/catalog'
import type { RecoverySourceStatus } from '../../../shared/questJournal/recovery'
import type { CandidateEvidence } from './screen'

interface JournalScan { status: RecoverySourceStatus; candidates: CandidateEvidence[]; warnings: string[] }
function missing(): JournalScan {
  return { candidates: [], warnings: [], status: { label: 'NPC conversation journal', state: 'missing', message: 'No exact-character NPC conversation journal was found.' } }
}

function readJournal(root: string, character: CharacterRef): string | undefined {
  if (!/^[a-z0-9_-]+$/iu.test(character.name) || !/^[a-z0-9_-]+$/iu.test(character.server)) return undefined
  const directory = join(root, 'userdata')
  const expected = `CJ_${character.name}_${character.server}.txt`.toLowerCase()
  const name = readdirSync(directory).find((candidate) => candidate.toLowerCase() === expected)
  if (!name) return undefined
  const path = join(directory, name)
  const before = statSync(path)
  if (!before.isFile() || before.size > 2 * 1024 * 1024) throw new Error('The NPC journal exceeds the supported 2 MB text limit.')
  const bytes = readFileSync(path)
  const after = statSync(path)
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('The NPC journal changed during the scan. Scan again.')
  return decodeJournal(bytes)
}

function decodeJournal(bytes: Buffer): string {
  let text: string
  if (bytes[0] === 0xff && bytes[1] === 0xfe) text = new TextDecoder('utf-16le', { fatal: true }).decode(bytes)
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) text = new TextDecoder('utf-16be', { fatal: true }).decode(bytes)
  else {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
    catch { text = new TextDecoder('windows-1252', { fatal: true }).decode(bytes) }
  }
  if (Array.from(text).some((char) => /\p{Cc}/u.test(char) && !['\r', '\n', '\t'].includes(char))) throw new Error('The NPC journal does not contain supported plain text.')
  return text
}

function quotes(entry: QuestJournalCatalogEntry): string[] {
  const found = new Set<string>()
  for (const section of entry.walkthrough ?? []) {
    // Quoted source dialogue only. Long prose outside a quote is not distinctive dialogue evidence.
    const pattern = /["“]([^"”\r\n]{60,2000})["”]|(?:says?|say),?\s+'([^\r\n]{60,2000}?)'(?:[.\s]|$)/giu
    for (const match of section.text.matchAll(pattern)) {
      const phrase = (match[1] ?? match[2]).trim()
      if ((phrase.match(/\p{L}/gu)?.length ?? 0) >= 60 && phrase.split(/\s+/u).length >= 8) found.add(phrase)
    }
  }
  return [...found]
}

function phraseCandidates(text: string, catalog: readonly QuestJournalCatalogEntry[], warnings: string[]): CandidateEvidence[] {
  const references = new Map<string, QuestJournalCatalogEntry[]>()
  for (const entry of catalog) for (const phrase of quotes(entry)) references.set(phrase, [...(references.get(phrase) ?? []), entry])
  const result = new Map<string, CandidateEvidence>()
  for (const [phrase, entries] of references) {
    if (!text.includes(phrase)) continue
    if (entries.length !== 1) { warnings.push('A saved journal phrase matches several quest sources; no quest was inferred from that phrase.'); continue }
    const entry = entries[0]
    result.set(entry.id, { questId: entry.id, name: entry.name, state: 'active', source: 'npc-journal', confidence: 'likely', selectedByDefault: false,
      evidence: ['A phrase from this quest’s source walkthrough appears in the exact-character saved NPC journal.',
        `Matched text: ${phrase.slice(0, 450)}${phrase.length > 450 ? '…' : ''}`,
        'This is a reference clue only. No speaker, conversation date, acceptance or completion was inferred. Select it only if you confirm this quest is active.'] })
  }
  return [...result.values()]
}

/** Official scope: https://www.everquest.com/news/imported-eq-enus-50616 describes saved dialogue
 * and user categories, not lifecycle records. This matches opaque text, never invents CJ grammar. */
export function npcJournalScan(root: string, character: CharacterRef, catalog: readonly QuestJournalCatalogEntry[]): JournalScan {
  const scan = missing()
  try {
    const text = readJournal(root, character)
    if (text === undefined) return scan
    scan.candidates = phraseCandidates(text, catalog, scan.warnings)
    scan.status = { ...scan.status, state: 'available', message: `${scan.candidates.length} long, unique source quotations matched. The saved record format is unverified; only optional reference clues are offered.` }
    return scan
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return scan
    return { ...scan, status: { ...scan.status, state: 'error', message: error instanceof Error ? error.message : 'The NPC conversation journal could not be read.' } }
  }
}

export function npcJournalStatus(root: string, character: CharacterRef): RecoverySourceStatus {
  return npcJournalScan(root, character, []).status
}
