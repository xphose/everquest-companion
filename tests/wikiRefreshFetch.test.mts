import test from 'node:test'
import assert from 'node:assert/strict'
import { createWikiQuery, wikiRetryDelay, WIKI_API } from '../src/main/wikiRefresh/fetch'

test('wiki network serializes concurrent callers, enforces one second, fixed endpoint and maxlag', async () => {
  let now = 0
  const starts: number[] = []
  const query = createWikiQuery({
    now: () => now, sleep: async (ms) => { now += ms },
    fetch: async (url, options) => {
      starts.push(now)
      assert.equal(new URL(String(url)).origin + new URL(String(url)).pathname, WIKI_API)
      assert.equal(new URL(String(url)).searchParams.get('maxlag'), '5')
      assert.equal(options?.redirect, 'error')
      assert.equal(options?.credentials, 'omit')
      return Response.json({ query: {} })
    }
  })
  await Promise.all([query({ list: 'allpages' }), query({ list: 'allpages' }), query({ list: 'allpages' })])
  assert.deepEqual(starts, [0, 1000, 2000])
})

test('wiki backoff honors numeric and HTTP date Retry-After, including maxlag HTTP 200', async () => {
  let now = Date.parse('2026-09-01T00:00:00Z')
  const waits: number[] = []
  const replies = [
    new Response('', { status: 429, headers: { 'retry-after': '3' } }),
    Response.json({ error: { code: 'maxlag' } }, { headers: { 'retry-after': 'Tue, 01 Sep 2026 00:00:08 GMT' } }),
    new Response('', { status: 503 }), Response.json({ query: {} })
  ]
  const query = createWikiQuery({ now: () => now,
    sleep: async (ms) => { waits.push(ms); now += ms }, fetch: async () => replies.shift()!
  })
  await query({ list: 'allpages' })
  assert.deepEqual(waits.filter(Boolean), [3000, 5000, 4000])
  assert.equal(wikiRetryDelay('not a date', now, 2000), 2000)
})

test('wiki repeated overload rejects rather than accepting a partial result', async () => {
  let requests = 0
  const query = createWikiQuery({ sleep: async () => { /* synthetic clock */ }, fetch: async () => {
    requests++
    return new Response('', { status: 429 })
  } })
  await assert.rejects(query({ list: 'allpages' }), /busy/)
  assert.equal(requests, 6)
})

test('wiki guards offline, redirects, malformed JSON, warnings, size, and abort', async () => {
  for (const reply of [
    new Response('bad json'), Response.json({ warnings: { revisions: 'truncated' }, query: {} }),
    new Response('oversize', { headers: { 'content-length': String(13 * 1024 * 1024) } })
  ]) {
    await assert.rejects(createWikiQuery({ sleep: async () => { /* synthetic clock */ }, fetch: async () => reply })({ list: 'allpages' }))
  }
  await assert.rejects(createWikiQuery({ fetch: async () => { throw new Error('offline') } })({ list: 'allpages' }), /offline/)
  const controller = new AbortController()
  controller.abort()
  let calls = 0
  await assert.rejects(createWikiQuery({ signal: controller.signal, fetch: async () => { calls++; return Response.json({}) } })({ list: 'allpages' }))
  assert.equal(calls, 0)
})

test('wiki respects a long server pause by stopping, and caps per-run requests', async () => {
  const query = createWikiQuery({ sleep: async () => { /* synthetic clock */ }, fetch: async () => new Response('', { status: 503, headers: { 'retry-after': '86400' } }) })
  await assert.rejects(query({ list: 'allpages' }), /longer pause/)
  const bounded = createWikiQuery({ maxRequests: 1, sleep: async () => { /* synthetic clock */ }, fetch: async () => Response.json({ query: {} }) })
  await bounded({ list: 'allpages' })
  await assert.rejects(bounded({ list: 'allpages' }), /request limit/)
})
