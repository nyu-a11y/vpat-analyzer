# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this project, **please do not open a public GitHub issue**. Instead, report it privately using one of the following methods:

- **GitHub Private Vulnerability Reporting** — Use the [Report a vulnerability](https://github.com/nyu-a11y/vpat-analysis-spreadsheet/security/advisories/new) button on the Security tab of this repository.
- **Email** — Send details to the repository maintainers listed in [CODEOWNERS](.github/CODEOWNERS).

Please include:

- A description of the vulnerability and its potential impact
- Steps to reproduce or a proof-of-concept
- Any suggested mitigations

We will acknowledge your report within **5 business days** and aim to resolve confirmed vulnerabilities within **30 days**.

## Supported Versions

This project does not use versioned releases. Security fixes are applied to the latest commit on the `main` branch.

## Keeping Your Copy Secure

Because this tool stores AI provider API keys inside a Google Sheet, users should follow these best practices:

- **Never commit API keys** to this repository or any other version-controlled system.
- **Restrict Google Sheet access** — share the sheet only with people who need it, using the minimum required permission level.
- **Rotate API keys** regularly and immediately if you suspect they have been exposed.
- **Use environment-scoped keys** where possible (e.g., an OpenAI project key scoped to a single project rather than an organization key).

## Recommended GitHub Repository Settings

The following settings are recommended to keep this repository secure. They must be configured by a repository administrator in the GitHub UI under **Settings**.

### Branch Protection (Settings → Branches)

Enable a branch protection rule for `main` with these options checked:

| Setting | Value |
|---|---|
| Require a pull request before merging | ✅ Enabled |
| Required number of approvals | 1 (minimum) |
| Dismiss stale pull request approvals when new commits are pushed | ✅ Enabled |
| Require review from Code Owners | ✅ Enabled (requires a `CODEOWNERS` file) |
| Require status checks to pass before merging | ✅ Enabled (when CI checks exist) |
| Require branches to be up to date before merging | ✅ Enabled |
| Require signed commits | ✅ Recommended |
| Do not allow bypassing the above settings | ✅ Enabled |
| Restrict who can push to matching branches | ✅ Limit to maintainers |

### Security Features (Settings → Advanced Security / Code Security)

| Feature | Recommendation |
|---|---|
| Dependency graph | ✅ Enable |
| Dependabot alerts | ✅ Enable |
| Dependabot security updates | ✅ Enable |
| Secret scanning | ✅ Enable |
| Push protection | ✅ Enable — prevents secrets from being committed |
| Private vulnerability reporting | ✅ Enable |

### General Settings (Settings → General)

| Setting | Recommendation |
|---|---|
| Restrict forking | Consider disabling public forks if the repository contains sensitive configuration |
| Default branch | Confirm `main` is the default branch |
| Automatically delete head branches | ✅ Enable — cleans up merged PR branches automatically |
| Allow merge commits | Configure to your team's preference; "Squash and merge" reduces noise in commit history |
