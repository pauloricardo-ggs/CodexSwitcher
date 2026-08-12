# Security policy

## Sensitive data

Every managed `CODEX_HOME` can contain `auth.json`, local conversations, configuration, plugins, and other Codex state. `auth.json` contains bearer credentials and must be protected like a password.

The extension does not intentionally log, transmit, copy between profiles, or save token contents in VS Code state. It reads token payload metadata locally only to derive the optional status-bar email.

## Recommended operation

- Keep the profile directory accessible only to the local user.
- Do not place it inside a repository or cloud-synchronized folder.
- Keep `cli_auth_credentials_store = "file"` in managed profiles so credentials are isolated by `CODEX_HOME`.
- Use **Forget Profile** before manually archiving a profile. The extension never deletes it automatically.
- Close Codex CLI processes using a profile before removing that profile yourself.

## Reporting a vulnerability

Please report vulnerabilities privately to the repository owner. Do not include `auth.json`, JWTs, API keys, refresh tokens, screenshots containing tokens, or complete profile archives in a report. Provide reproduction steps using redacted or synthetic credentials.
