// Deterministic, display-only extraction of already-cached source prose. No inferred steps.
import { splitSections, stripMarkup } from './sources/questPage'
import type { QuestJournalWalkthrough } from '../src/shared/questJournal/catalog'

const MAX_CHARS = 40_000
const MAX_SECTIONS = 64

function templateText(body: string): string {
  const [name, ...args] = body.split('|')
  if (name.startsWith(':')) return name.slice(1).trim()
  if (/^(exp|yougainexperience)$/i.test(name.trim())) return 'You gain experience.'
  if (/^loc$/i.test(name.trim())) return args.at(-1)?.trim() ?? ''
  return ''
}

/** Balanced scanning also removes nested navboxes; a single regex cannot do that. */
function withoutTemplates(text: string): string {
  let depth = 0
  let start = 0
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const pair = text.slice(i, i + 2)
    if (pair === '{{') {
      if (depth === 0) start = i + 2
      depth++
      i++
    } else if (pair === '}}' && depth > 0) {
      depth--
      if (depth === 0) out += templateText(text.slice(start, i))
      i++
    } else if (depth === 0) out += text[i]
  }
  return out
}

function readableText(raw: string): string {
  const text = withoutTemplates(raw
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/\[\[(?:file|image|category):[^\]]*\]\]/gi, '')
    .replace(/__(?:NOTOC|TOC|FORCETOC|NOEDITSECTION)__/g, ''))
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/?(?:blockquote|p|div|ul|ol|li)\b[^>]*>/gi, '\n')
    .replace(/\[(https?:\/\/[^\s\]]+)\s+([^\]]+)\]/g, '$2 ($1)')
    .replace(/^\s*(?:\{\||\|\}|\|-|----+).*$/gm, '')
    .replace(/^\s*[|!]\s*/gm, '')
    .replace(/(?:style|class|rowspan|colspan|align)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s|]+)\s*\|?/g, '')
    .replace(/[|!]{2}/g, ' | ')
    .replace(/^[#:;]+\s*/gm, '')
    .replace(/^\*+\s*/gm, '• ')
  // Existing stripMarkup collapses whitespace, so apply per line to retain paragraphs.
  return text.split('\n').map((line) => stripMarkup(line)
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>'))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function extractQuestWalkthrough(wikitext: string): QuestJournalWalkthrough {
  const top = /\{\|[^\n]*questTopTable[^\n]*\n([\s\S]*?)\n\|\}/i
  const details = top.exec(wikitext)?.[1]
  const body = wikitext.replace(top, '')
  const { lead, sections } = splitSections(body)
  const candidates = [
    ...(details ? [{ heading: 'Quest details', text: details }] : []),
    { heading: '', text: lead }, ...sections
  ]
    .filter((section) => !/^(rewards?|related quests?)\b/i.test(section.heading))
    .map((section) => ({ heading: stripMarkup(section.heading) || undefined, text: readableText(section.text) }))
    .filter((section) => section.text.length > 0)
  const result: QuestJournalWalkthrough = { sections: [], truncated: false }
  let remaining = MAX_CHARS
  for (const section of candidates) {
    if (remaining <= 0 || result.sections.length >= MAX_SECTIONS) {
      result.truncated = true
      break
    }
    const text = section.text.slice(0, remaining)
    result.sections.push({ ...section, text })
    remaining -= text.length
    if (text.length < section.text.length) result.truncated = true
  }
  return result
}
