import { DARK_DEPLOYMENT, type DeploymentConfig } from '../shared/deployment'

declare const __EQC_DEPLOYMENT__: Readonly<DeploymentConfig>

// Vite substitutes verified build metadata. Unbundled tools/tests stay dark, regardless
// of runtime environment variables. Packaged users cannot redirect these services.
export const DEPLOYMENT: Readonly<DeploymentConfig> =
  typeof __EQC_DEPLOYMENT__ === 'undefined' ? DARK_DEPLOYMENT : Object.freeze(__EQC_DEPLOYMENT__)
