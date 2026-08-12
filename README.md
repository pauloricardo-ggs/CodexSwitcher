# Codex Switcher

Codex Switcher gives each Codex account an isolated `CODEX_HOME`, shows the active account in the VS Code status bar, and safely restarts VS Code when you switch profiles.

> This is an independent extension and is not affiliated with or endorsed by OpenAI. Native multi-account switching is not currently a Codex feature; this extension uses the documented `CODEX_HOME` and file credential storage behavior.

Official references: [Codex authentication](https://developers.openai.com/codex/auth) and [Codex configuration reference](https://developers.openai.com/codex/config-reference).

## Why a restart is required

`CODEX_HOME` is selected by the process that starts Codex. The Codex account does not choose its own directory. The Codex CLI and IDE extension reuse credentials from that home, so changing accounts reliably requires starting VS Code with a different environment:

```text
VS Code process
└── CODEX_HOME=/path/to/profile
    └── Codex extension
        ├── config.toml
        └── auth.json
```

An extension cannot replace the environment of an already-running VS Code process. Codex Switcher therefore starts a small detached relaunch helper, asks VS Code to quit normally, waits for the old processes to stop, and starts VS Code again with the selected `CODEX_HOME`.

## Features

- Active-account indicator in the status bar.
- Email detection from local Codex token metadata, with profile-name fallback.
- One isolated `CODEX_HOME` per managed account.
- Optional custom directory for each new account, with a predictable `~/.codex_<profile>` default.
- Browser login or Codex device-code login.
- Local and remote workspace reopening.
- Cross-platform process launching for macOS, Linux, and Windows, using the launcher bundled with the current VS Code application.
- No token copying during account switches.
- No credentials stored in VS Code settings, global state, telemetry, or logs.

## Requirements

- VS Code 1.96 or newer.
- The official Codex extension.
- The `codex` CLI available on VS Code's `PATH`, or its absolute path configured in `Codex Switcher: Codex Executable`.

## Getting started

1. Install the extension and reload VS Code.
2. Open the Command Palette.
3. Run **Codex Accounts: Register Current Account** to keep the account you already use.
4. Run **Codex Accounts: Add Account** and complete the login shown in the local output panel/browser.
5. Click the Codex account indicator in the status bar or run **Codex Accounts: Switch Account**.
6. Confirm the restart. All VS Code windows close normally and the selected workspace reopens.

Registering the current account stores only its profile name and existing `CODEX_HOME` path. It does not copy its credentials.

## Commands

| Command | Purpose |
| --- | --- |
| `Codex Accounts: Add Account` | Create an isolated profile and authenticate it. |
| `Codex Accounts: Register Current Account` | Add the current `CODEX_HOME` to the profile picker without copying it. |
| `Codex Accounts: Switch Account` | Select a profile and relaunch VS Code. |
| `Codex Accounts: Forget Profile` | Remove a profile from the picker without deleting credentials. |
| `Codex Accounts: Refresh Indicator` | Reread the current local identity metadata. |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `codexAccountSwitcher.codexExecutable` | `codex` | Codex CLI used for login. |
| `codexAccountSwitcher.vscodeExecutable` | empty | Optional VS Code/fork CLI launcher override used for restart. |
| `codexAccountSwitcher.useDeviceAuth` | `false` | Use `codex login --device-auth`. |
| `codexAccountSwitcher.confirmBeforeRestart` | `true` | Confirm before closing every VS Code window. |
| `codexAccountSwitcher.showEmail` | `true` | Display email when local token metadata contains one. |

## Where profiles live

When adding an account, you can enter an absolute directory path (or one beginning with `~/`). If you leave the field empty, the profile uses a predictable directory in your home folder:

```text
~/.codex_<lowercase-profile-name>/
├── config.toml
└── auth.json
```

The default folder name uses the lowercase profile name and replaces spaces with underscores. For example, `Work Account` uses `~/.codex_work_account`. Profile names may contain only unaccented letters, numbers, spaces, hyphens, and underscores. Names are unique after this normalization, so `Work Account`, `work account`, and `work_account` identify the same profile name, while `workaccount` remains distinct.

The extension writes this setting into every managed profile:

```toml
cli_auth_credentials_store = "file"
```

This matters because OS keychain storage may be shared independently of `CODEX_HOME`. File storage keeps the credential cache inside the selected profile.

## Security model

- `auth.json` contains access and refresh tokens. Treat it like a password.
- The status-bar email is decoded locally from JWT payload metadata. The signature is not verified because the value is only a UI label and is never used for authorization.
- Token contents are never sent anywhere by this extension.
- Profile metadata saved by the extension contains only ID, display name, directory path, creation time, and whether the directory is extension-managed.
- Forgetting a profile deliberately does not delete files. This avoids accidental credential or history loss.
- Do not commit, sync, paste, or upload a profile directory.

The bundled `SECURITY.md` contains reporting and operational guidance.

## Known limitations

- Switching requires all windows belonging to the current VS Code instance to close. Otherwise the existing process can retain its old environment.
- Unsaved editor state is handled by VS Code's normal quit and hot-exit behavior. If you cancel VS Code's quit prompt, the helper times out and does not relaunch.
- VS Code can restore additional windows according to the user's `window.restoreWindows` setting. The workspace from which the switch was requested is passed explicitly to the relaunch.
- Remote extension hosts do not own the switcher. The extension declares `extensionKind: ["ui"]`, and its login child process, account selection, and restart happen on the local machine.
- The email indicator depends on the current local `auth.json` token schema. If no recognized email claim exists, the extension displays the profile name.
- This project relies on documented Codex configuration, but it is not an official OpenAI account switcher.

## Development

```bash
npm install
npm run check
npm test
npm run package
```

Press `F5` in VS Code to run an Extension Development Host. Before publishing, test the packaged VSIX on each supported operating system, including a real two-account switch and a workspace containing unsaved editors.

The included GitHub Actions workflow runs type-checking and unit tests on macOS, Linux, and Windows, then produces a VSIX artifact on Linux.

## Publishing a new version

Release creation is driven by the root version in `package-lock.json`. On a push to `main`, the workflow first checks whether a GitHub Release named `v<version>` already exists:

- If the release already exists, validation, packaging, and release creation are skipped.
- If it does not exist, the workflow runs validation and packaging, then creates the matching Git tag and GitHub Release and attaches the generated VSIX to the release.

Use one of the following commands according to the kind of change:

```bash
# Bug fixes: 0.1.0 -> 0.1.1
npm version patch

# Backward-compatible features: 0.1.0 -> 0.2.0
npm version minor

# Breaking changes: 0.1.0 -> 1.0.0
npm version major
```

`npm version` updates both `package.json` and `package-lock.json`, creates a version commit, and creates a local tag. Push the commit to `main`:

```bash
git push origin main
```

The local tag does not need to be pushed; the workflow creates the GitHub release tag from the root version in `package-lock.json`. Do not reuse a released version. Update `CHANGELOG.md` before running `npm version` so its changes are included in the version commit.

After the workflow finishes, download the `.vsix` file from the GitHub Release and upload it manually from the Visual Studio Marketplace publisher management page. The pipeline does not publish to the Marketplace and does not require Marketplace credentials, GitHub secrets, or variables.

## Architecture

The extension contains five small layers:

- `extension.ts`: VS Code UI and command orchestration.
- `identity.ts`: defensive parsing of local display metadata.
- `profileFiles.ts`: isolated profile setup.
- `relaunchPlan.ts`: workspace relaunch argument construction.
- `relauncher.ts`: detached process wait and restart.

Pure parsing, profile-file behavior, and relaunch planning are covered by Node unit tests.

## License

MIT
