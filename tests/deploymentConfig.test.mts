import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readDeployment, packagingDeployment } from '../scripts/deployment-config.cjs'
import { DARK_DEPLOYMENT, releasesApiUrl, updatesConfigured } from '../src/shared/deployment'
import { DEPLOYMENT } from '../src/main/deployment'
import { allowedUploadUrlFor } from '../src/main/feedback/net'
import { postTelemetryBatch } from '../src/main/telemetry/net'
import { fetchGhDownloads } from '../src/main/triage/ghDownloads'

const services = {
  EQC_FEEDBACK_API_URL: 'https://feedback.example.invalid/v1/feedback',
  EQC_FEEDBACK_S3_BUCKET: 'sample-feedback-logs',
  EQC_FEEDBACK_S3_REGION: 'us-west-2',
  EQC_TELEMETRY_API_URL: 'https://telemetry.example.invalid/v1/telemetry'
}
const release = {
  EQC_RELEASE_OWNER: 'example-project', EQC_RELEASE_REPO: 'companion',
  EQC_SIGNING_PUBLISHER: 'Example Project',
  AZURE_SIGNING_ENDPOINT: 'https://example.codesigning.azure.net/',
  AZURE_SIGNING_ACCOUNT: 'example-signing', AZURE_SIGNING_PROFILE: 'example-public'
}

test('default builds are dark and unsigned, with no inferred publisher or repository', () => {
  assert.deepEqual(readDeployment({}), DARK_DEPLOYMENT)
  assert.deepEqual(DEPLOYMENT, DARK_DEPLOYMENT)
  assert.equal(updatesConfigured(DEPLOYMENT), false)
  assert.equal(releasesApiUrl(DEPLOYMENT), '')
  assert.deepEqual(packagingDeployment({}), {
    publish: null, forceCodeSigning: false, win: { signtoolOptions: { publisherName: null } }
  })
})

test('configured services retain exact S3 host and path boundaries', () => {
  const config = readDeployment(services)
  assert.equal(config.feedbackApiUrl, services.EQC_FEEDBACK_API_URL)
  assert.equal(config.telemetryApiUrl, services.EQC_TELEMETRY_API_URL)
  const allow = (url: string) => allowedUploadUrlFor(url, config.feedbackBucket, config.feedbackRegion)
  const host = 'sample-feedback-logs.s3.us-west-2.amazonaws.com'
  assert.equal(allow(`https://${host}/`), `https://${host}/`)
  assert.equal(allow('https://s3.us-west-2.amazonaws.com/sample-feedback-logs'), 'https://s3.us-west-2.amazonaws.com/sample-feedback-logs')
  for (const url of [`https://${host}.evil.invalid/`, `http://${host}/`, `https://${host}/wrong`,
    'https://other-logs.s3.us-west-2.amazonaws.com/', 'https://sample-feedback-logs.s3.us-east-1.amazonaws.com/']) {
    assert.equal(allow(url), null)
  }
})

test('invalid or partial build configuration fails without echoing supplied values', () => {
  const invalid = [
    { EQC_FEEDBACK_API_URL: services.EQC_FEEDBACK_API_URL },
    { ...services, EQC_FEEDBACK_S3_BUCKET: 'sample.logs' },
    { ...services, EQC_FEEDBACK_S3_REGION: 'us-west-2.evil.invalid' },
    { EQC_TELEMETRY_API_URL: 'http://telemetry.example.invalid/v1/telemetry' },
    { EQC_TELEMETRY_API_URL: 'https://user:private@telemetry.example.invalid/v1/telemetry' },
    { EQC_TELEMETRY_API_URL: 'https://telemetry.example.invalid/v1/telemetry?private=value' },
    { EQC_TELEMETRY_API_URL: 'https://telemetry.example.invalid:8443/v1/telemetry' },
    { EQC_TELEMETRY_API_URL: 'https://telemetry.example.invalid/wrong' },
    { EQC_RELEASE_OWNER: 'example-project' },
    { ...release, EQC_RELEASE_REPO: '../wrong' },
    { EQC_SIGNING_PUBLISHER: 'unsafe\nname' }
  ]
  for (const env of invalid) {
    assert.throws(() => readDeployment(env), (err) => err instanceof Error && !err.message.includes('private'))
  }
})

test('release packaging uses only configured repository and verified publisher settings', () => {
  const config = readDeployment(release)
  assert.equal(updatesConfigured(config), true)
  assert.equal(releasesApiUrl(config), 'https://api.github.com/repos/example-project/companion/releases?per_page=100')
  assert.deepEqual(packagingDeployment(release), {
    publish: { provider: 'github', owner: 'example-project', repo: 'companion' },
    forceCodeSigning: true, win: { signtoolOptions: { publisherName: 'Example Project' } }
  })
  assert.throws(() => packagingDeployment({ EQC_RELEASE_OWNER: 'example-project', EQC_RELEASE_REPO: 'companion' }))
  assert.throws(() => packagingDeployment({ AZURE_SIGNING_ACCOUNT: 'example-signing' }))
})

test('electron-builder resolves the actual inherited configuration without a publisher default', async () => {
  const require = createRequire(import.meta.url)
  const { getConfig, validateConfiguration } = require('app-builder-lib/out/util/config/config')
  const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const config = await getConfig(repository)
  await validateConfiguration(config)
  assert.equal(config.publish, null)
  assert.equal(config.forceCodeSigning, false)
  assert.equal(config.win.signtoolOptions.publisherName, null)
  assert.equal(config.win.signtoolOptions.sign, 'scripts/azure-sign.cjs')
})

test('runtime environment changes do not redirect an unbundled build', () => {
  const path = new URL('../src/main/deployment.ts', import.meta.url).href
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
    `const { DEPLOYMENT } = await import(${JSON.stringify(path)}); process.stdout.write(JSON.stringify(DEPLOYMENT));`
  ], { encoding: 'utf8', env: { ...process.env, ...services, ...release } })
  assert.equal(result.status, 0)
  assert.deepEqual(JSON.parse(result.stdout), DARK_DEPLOYMENT)
})

test('dark telemetry and release readouts perform no fetch even when called directly', async () => {
  const fetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => { calls++; throw new Error('Unexpected network request') }
  try {
    assert.deepEqual(await postTelemetryBatch({} as Parameters<typeof postTelemetryBatch>[0]), { status: 0 })
    assert.equal((await fetchGhDownloads()).available, false)
    assert.equal(calls, 0)
  } finally { globalThis.fetch = fetch }
})
