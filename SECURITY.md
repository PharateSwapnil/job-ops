# Security Policy

## Supported Versions

Only the latest commit on `main` is actively maintained.

| Version | Supported |
|---------|-----------|
| Latest (`main`) | ✅ |
| Older tags | ❌ — please upgrade |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Please report security issues privately via one of:

- **GitHub private security advisory:** [Submit here](../../security/advisories/new)
- **Email:** open a GitHub issue with the title `[SECURITY] <brief description>` and we will respond with a private channel

We aim to acknowledge reports within **48 hours** and provide a fix or mitigation within **14 days** for confirmed issues.

## What to Report

- Authentication or authorization bypasses
- Credential exposure or encryption weaknesses in the automation module
- SQL injection or data exfiltration paths
- Secrets or API keys accidentally committed to the repository
- Dependencies with known CVEs that affect this project

## What NOT to Report

- Issues in upstream dependencies that have no impact on Job-Ops
- Missing security headers on a self-hosted instance you control
- Theoretical issues without a concrete exploitation path

## Security-Sensitive Areas

These areas of the codebase handle sensitive data and should receive extra scrutiny:

| Area | Concern |
|------|---------|
| `orchestrator/src/server/automation/services/credentials.ts` | AES-256-GCM encryption of platform passwords |
| `orchestrator/src/server/auth/` | JWT generation and password hashing |
| `orchestrator/src/server/api/routes/automation/` | Credential CRUD endpoints |
| `.env` / `.env.example` | Must never contain real secrets |

## Local Security Checklist (Self-Hosters)

- [ ] Set `AUTOMATION_SECRET` to a random 32+ character string
- [ ] Set `JOBOPS_AUTH_SECRET` (JWT secret) to a random 64+ character string  
- [ ] Set `BASIC_AUTH_USER` and `BASIC_AUTH_PASSWORD` if exposing to the internet
- [ ] Never commit your `.env` file — it is in `.gitignore`
- [ ] Use HTTPS (reverse proxy with TLS) if accessible outside localhost
- [ ] Keep `data/` directory outside the repository and web root
