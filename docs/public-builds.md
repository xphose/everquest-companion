# Portable, private builds

Game installation and log paths come from discovery, Settings, or `EQ_INSTALL_DIR`.
Application settings and backups use the OS application-data directory. Scripts
resolve their checkout from their own location; sandbox wrappers also accept explicit
repository and results directories. No developer's home directory is required.

Local builds work without a cloud deployment. Feedback, telemetry, automatic updates,
and signing are unconfigured by default. Optional service configuration is validated
at build time and compiled into the main process; it is not a runtime endpoint override.

| Build variable | Purpose |
| --- | --- |
| `EQC_FEEDBACK_API_URL` | HTTPS endpoint ending in `/v1/feedback` |
| `EQC_FEEDBACK_S3_BUCKET` | Exact permitted upload bucket |
| `EQC_FEEDBACK_S3_REGION` | Region of that bucket; set all three feedback values together |
| `EQC_TELEMETRY_API_URL` | Optional HTTPS endpoint ending in `/v1/telemetry` |
| `EQC_RELEASE_OWNER`, `EQC_RELEASE_REPO` | Repository for this build's releases |
| `EQC_SIGNING_PUBLISHER` | Certificate publisher expected for signed updates |

Release packaging also requires the existing `AZURE_SIGNING_ENDPOINT`,
`AZURE_SIGNING_ACCOUNT`, and `AZURE_SIGNING_PROFILE` values and signing credentials.
Configure CI through repository variables/secrets. Leave release settings absent for
a local unsigned build. Existing application identity and public data attribution are
preserved so local settings continue to load.

Terraform backend configuration and the alarm email must be supplied for each
deployment; follow `infra/README.md`. Sandbox smoke tests require an explicit installer
source and never choose another maintainer's release automatically.

Before committing, review the staged diff and run:

```sh
npm run privacy:check -- --staged
```

Before sharing, scan the current files and all unpublished commits, including their
messages and author/committer information:

```sh
npm run privacy:check -- --history <published-base-ref>
```

The check reports locations and categories without printing matching values. Optional
local private terms can be supplied with `EQC_PRIVACY_TERMS_FILE`, a newline-separated
file outside the repository. Never commit that file or a list of real private values.
Use synthetic identities for test data. Keep raw diagnostics, screenshots, credentials,
local configurations, and recovery backups outside version control.

A scan cannot establish that every arbitrary string is non-private; review new data
and images before adding them. Removing a value from the current files does not remove
it from earlier commits. Preserve a private external backup before repairing unpublished
history, and do not rewrite published history or push without authorization.
