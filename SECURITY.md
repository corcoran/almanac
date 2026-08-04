# Security Policy

Almanac is a self-hosted personal fitness tracker. It stores personal health
data (nutrition, body weight, sleep, training) and gates access behind
authentication, so security reports are taken seriously.

## Supported versions

Almanac is released as a rolling line of container images; only the latest
release receives security fixes. Please make sure you can reproduce an issue
against the most recent release before reporting.

| Version | Supported          |
| ------- | ------------------ |
| Latest release | :white_check_mark: |
| Older releases | :x:         |

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues,
pull requests, or discussions.** A public issue exposes the flaw before a fix
is available.

Instead, use GitHub's private vulnerability reporting:

1. Go to the **Security** tab of this repository.
2. Click **Report a vulnerability**.
3. Describe the issue with enough detail to reproduce it — affected version,
   steps, and impact.

This opens a private advisory visible only to you and the maintainers.

### What to expect

- An acknowledgement of your report as soon as it is triaged.
- An assessment of whether it is in scope and its severity.
- A fix in a subsequent release, with the vulnerability disclosed publicly
  (crediting you, if you wish) once users have had a reasonable window to
  update.

Because Almanac is a solo-maintained hobby project, response times are
best-effort — thank you for your patience and for reporting responsibly.

## Scope

In scope:

- Authentication and authorization flaws (e.g. accessing another user's data,
  IDOR, auth bypass).
- Injection, SSRF, or similar flaws in the API, MCP server, or web app.
- Secrets or personal data unintentionally exposed by the application.

Out of scope:

- Issues that require an already-compromised host or a malicious operator with
  server access — Almanac trusts its own deployment environment.
- Misconfiguration of a self-hosted deployment (e.g. exposing the API without
  the documented reverse-proxy auth in front of it). See the deployment
  runbook in [`deploy/README.md`](deploy/README.md) for the intended setup.
- Vulnerabilities in third-party dependencies with no demonstrated impact on
  Almanac; report those upstream.
