// Build-time only. Shared by Vite and electron-builder; never loaded by packaged main.
function value(env, key) {
  const text = env[key] ?? ''
  if (typeof text !== 'string' || text !== text.trim() || [...text].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
    throw new Error(`${key} must be a plain value without surrounding whitespace`)
  }
  return text
}

function endpoint(raw, key, route) {
  if (!raw) return ''
  let url
  try { url = new URL(raw) } catch { throw new Error(`${key} must be an HTTPS URL`) }
  if (raw.length > 2048 || !plainHttps(url) || !/^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/.test(url.hostname) || url.pathname !== route) {
    throw new Error(`${key} must be an HTTPS service URL ending in ${route}, without credentials, query, fragment or port`)
  }
  return url.href
}

function plainHttps(url) {
  return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && !url.port
}

function feedback(env) {
  const feedbackApiUrl = endpoint(value(env, 'EQC_FEEDBACK_API_URL'), 'EQC_FEEDBACK_API_URL', '/v1/feedback')
  const feedbackBucket = value(env, 'EQC_FEEDBACK_S3_BUCKET')
  const feedbackRegion = value(env, 'EQC_FEEDBACK_S3_REGION')
  if (feedbackApiUrl || feedbackBucket || feedbackRegion) {
    if (!feedbackApiUrl || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(feedbackBucket) ||
        !/^[a-z]{2}-[a-z]+-\d$/.test(feedbackRegion)) {
      throw new Error('Configure EQC_FEEDBACK_API_URL, EQC_FEEDBACK_S3_BUCKET and EQC_FEEDBACK_S3_REGION together; bucket and region must be valid exact S3 names')
    }
  }
  return { feedbackApiUrl, feedbackBucket, feedbackRegion }
}

function release(env) {
  const releaseOwner = value(env, 'EQC_RELEASE_OWNER')
  const releaseRepo = value(env, 'EQC_RELEASE_REPO')
  const signingPublisher = value(env, 'EQC_SIGNING_PUBLISHER')
  if (releaseOwner || releaseRepo) {
    if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(releaseOwner) ||
        !/^[a-zA-Z0-9_-][a-zA-Z0-9._-]{0,99}$/.test(releaseRepo) || releaseRepo === '..') {
      throw new Error('Configure valid EQC_RELEASE_OWNER and EQC_RELEASE_REPO together')
    }
  }
  if (signingPublisher && (signingPublisher.length > 200 || /[<>]/.test(signingPublisher))) {
    throw new Error('EQC_SIGNING_PUBLISHER must be the certificate publisher name')
  }
  return { releaseOwner, releaseRepo, signingPublisher }
}

function readDeployment(env = process.env) {
  return Object.freeze({
    ...feedback(env),
    telemetryApiUrl: endpoint(value(env, 'EQC_TELEMETRY_API_URL'), 'EQC_TELEMETRY_API_URL', '/v1/telemetry'),
    ...release(env)
  })
}

function packagingDeployment(env = process.env) {
  const config = readDeployment(env)
  const signingKeys = ['AZURE_SIGNING_ENDPOINT', 'AZURE_SIGNING_ACCOUNT', 'AZURE_SIGNING_PROFILE']
  const signing = signingKeys.some((key) => !!env[key])
  if (signing && (!config.signingPublisher || signingKeys.some((key) => !value(env, key)))) {
    throw new Error('Signing requires EQC_SIGNING_PUBLISHER and all AZURE_SIGNING_* deployment values')
  }
  if (config.releaseOwner && (!config.signingPublisher || !signing)) {
    throw new Error('Release packaging requires an explicitly configured signing publisher and signer; omit release settings for a local unsigned build')
  }
  return {
    publish: config.releaseOwner ? { provider: 'github', owner: config.releaseOwner, repo: config.releaseRepo } : null,
    forceCodeSigning: signing,
    win: { signtoolOptions: { publisherName: config.signingPublisher || null } }
  }
}

module.exports = { readDeployment, packagingDeployment }
