/* eslint-disable @typescript-eslint/no-require-imports */
const { packagingDeployment } = require('./deployment-config.cjs')
/* eslint-enable @typescript-eslint/no-require-imports */

module.exports = () => packagingDeployment(process.env)
