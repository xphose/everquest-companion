/** Public files are not exempt by directory. Synthetic home paths are permitted only in tests/redaction vectors.
 * Examples elsewhere should use <user> or environment variables; public/default Windows profiles are not people.
 * Private terms are local, newline-separated data, never an allow-list committed beside the scanner. */
export interface PrivacyFinding { file: string; line: number; category: string; count: number }
interface Rule { category: string; pattern: RegExp }
const RULES: Rule[] = [
  { category: 'private-key', pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g },
  { category: 'credential', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { category: 'credential', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{60,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/g },
  { category: 'credential', pattern: /\b(?:npm_[A-Za-z0-9]{36,}|glpat-[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{35}|sk_live_[A-Za-z0-9]{16,})\b/g },
  { category: 'credential', pattern: /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{32,}\b/g },
  { category: 'credential', pattern: /(?:api[_-]?key|client[_-]?secret|access[_-]?token|password|aws_secret_access_key)["']?\s*[:=]\s*["'][A-Za-z0-9_+/=-]{24,}["']/gi },
  { category: 'credential', pattern: /https?:\/\/[^\s/:@]+:[^\s/@]{8,}@/gi }
]
const EMAIL = /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Z0-9.-]{1,253}\.[A-Z]{2,24}/gi
const HOME = /(?:[A-Za-z]:[\\/]+Users[\\/]+|\/(?:Users|home)\/)([^\\/\s"'<>]+)/gi
const SYNTHETIC = /^(?:example|test|tester|test-user|alice|bob|me|you|someone|u)$/i
const VECTOR = /(?:^|\/)(?:tests?\/|[^/]*redact[^/]*\.(?:[cm]?[jt]s|tsx)$|src\/(?:shared\/errorReport|main\/security)\.ts$)/i
const EXAMPLE = /(?:^|[._-])(?:example|sample|template)(?:[._-]|$)/i

function termRules(terms: readonly string[]): Rule[] {
  return terms.filter(Boolean).map((term) => ({ category: 'private-term', pattern: new RegExp(
    `(?<![a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`, 'gi') }))
}
function safeEmail(value: string): boolean {
  const [local, domain] = value.toLowerCase().split('@')
  return /(?:^|[.+_-])no-?reply(?:$|[.+_-])/.test(local) ||
    /^(?:.*\.)?(?:example\.com|example\.invalid|noreply\.github\.com)$/.test(domain)
}
function privateHome(file: string, user: string): boolean {
  if (/^(?:public|default|default user|all users)$/i.test(user)) return false
  if (/^(?:%[^%]+%|\$\{[^}]+\}|\$env:)/i.test(user)) return false
  if (/^(?:\[redacted\]|\[user\]|\{user\}|\.\.\.|…)$/i.test(user)) return false
  return !(VECTOR.test(file) && SYNTHETIC.test(user))
}
export function sensitiveArtifact(file: string): boolean {
  const name = file.split('/').at(-1) ?? file
  if (EXAMPLE.test(name)) return false
  return /^(?:\.env(?:\..*)?|\.envrc|credentials(?:\..*)?|local\.config(?:\..*)?|id_(?:rsa|dsa|ecdsa|ed25519))$/i.test(name) ||
    /(?:\.local\.(?:json|ya?ml|toml|ini)|\.(?:key|p12|pfx|keystore))$/i.test(name)
}
function matches(text: string, file: string, terms: readonly string[]): Map<string, number> {
  const result = new Map<string, number>()
  const add = (category: string, count: number): void => { if (count) result.set(category, (result.get(category) ?? 0) + count) }
  for (const rule of [...RULES, ...termRules(terms)]) add(rule.category, [...text.matchAll(rule.pattern)].length)
  // npm preserves upstream notices verbatim; this exception does not cover authors, settings or secrets.
  const dependencyNotice = /(?:^|\/)package-lock\.json$/.test(file) && /^\s*"deprecated":\s*"/.test(text)
  if (!dependencyNotice) add('private-email', [...text.matchAll(EMAIL)].filter((match) => !safeEmail(match[0])).length)
  add('private-home', [...text.matchAll(HOME)].filter((match) => privateHome(file, match[1])).length)
  return result
}
/** File names can contain secrets too. Every displayed location is sanitized before formatting. */
export function safeLocation(file: string, terms: readonly string[]): string {
  let value = file.replace(/[\r\n\t]/g, '?')
  for (const rule of [...RULES, ...termRules(terms)]) value = value.replace(rule.pattern, '[redacted]')
  return value.replace(EMAIL, (email) => safeEmail(email) ? email : '[redacted]')
    .replace(HOME, (path, user: string) => privateHome(file, user) ? '[private-home]' : path)
}
export function scanPrivacy(file: string, text: string, terms: readonly string[] = []): PrivacyFinding[] {
  const location = safeLocation(file, terms)
  const findings: PrivacyFinding[] = sensitiveArtifact(file) ? [{ file: location, line: 0, category: 'sensitive-artifact', count: 1 }] : []
  for (const [category, count] of matches(file, file, terms)) findings.push({ file: location, line: 0, category, count })
  text.split(/\r?\n/).forEach((line, index) => {
    for (const [category, count] of matches(line, file, terms)) findings.push({ file: location, line: index + 1, category, count })
  })
  return findings
}
export function formatPrivacy(findings: readonly PrivacyFinding[]): string {
  return findings.map((item) => `${item.file}:${item.line} ${item.category} count=${item.count}`).join('\n')
}
