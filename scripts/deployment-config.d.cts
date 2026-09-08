import type { DeploymentConfig } from '../src/shared/deployment'

export function readDeployment(env?: Record<string, string | undefined>): Readonly<DeploymentConfig>
export function packagingDeployment(env?: Record<string, string | undefined>): {
  publish: { provider: 'github'; owner: string; repo: string } | null
  forceCodeSigning: boolean
  win: { signtoolOptions: { publisherName: string | null } }
}
