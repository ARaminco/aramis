# Security Policy

Aramis can execute shell commands, read and write files, and store AI provider credentials. Treat every deployment as privileged infrastructure software.

## Supported Versions

Security fixes target the latest released version on the `master` branch.

## Reporting a Vulnerability

Please report sensitive issues privately to Aliasghar Ramin through https://aramin.co instead of opening a public issue.

Include:

- A concise description of the vulnerability.
- Reproduction steps or a proof of concept.
- Affected version, OS, and deployment mode.
- Any known mitigations.

## Deployment Notes

- Set a strong `JWT_SECRET` in production.
- Serve Aramis only over HTTPS behind a trusted reverse proxy.
- Keep Manual approval enabled on shared machines.
- Do not expose the server port directly to the public internet without authentication and rate limiting.
