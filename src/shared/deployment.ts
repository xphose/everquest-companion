/** Public build metadata, never credentials or a runtime endpoint override. */
export interface DeploymentConfig {
  feedbackApiUrl: string
  feedbackBucket: string
  feedbackRegion: string
  telemetryApiUrl: string
  releaseOwner: string
  releaseRepo: string
  signingPublisher: string
}

export const DARK_DEPLOYMENT: Readonly<DeploymentConfig> = Object.freeze({
  feedbackApiUrl: '', feedbackBucket: '', feedbackRegion: '', telemetryApiUrl: '',
  releaseOwner: '', releaseRepo: '', signingPublisher: ''
})

export function updatesConfigured(config: Readonly<DeploymentConfig>): boolean {
  return !!(config.releaseOwner && config.releaseRepo && config.signingPublisher)
}

export function releasesApiUrl(config: Readonly<DeploymentConfig>): string {
  return config.releaseOwner && config.releaseRepo
    ? `https://api.github.com/repos/${config.releaseOwner}/${config.releaseRepo}/releases?per_page=100`
    : ''
}
