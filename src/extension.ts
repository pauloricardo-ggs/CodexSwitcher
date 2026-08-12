import { spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import * as vscode from "vscode";
import {
  resolveExecutable,
  resolveVsCodeLauncher,
  windowsCommandInvocation,
} from "./executable.js";
import { readCodexIdentity } from "./identity.js";
import {
  authJsonPath,
  ensureFileCredentialStorage,
  fileExists,
} from "./profileFiles.js";
import {
  defaultCodexHome,
  resolveCodexHome,
  validateCodexHomeInput,
  validateProfileName,
} from "./profileValidation.js";
import { buildLaunchArguments } from "./relaunchPlan.js";
import type {
  CodexIdentity,
  CodexProfile,
  CodexUsage,
  RelaunchPayload,
} from "./types.js";
import { presentUsage, queryCodexUsage } from "./usage.js";

const PROFILES_KEY = "codexAccountSwitcher.profiles.v1";
const RESTART_TIMEOUT_MS = 60_000;
const USAGE_REFRESH_INTERVAL_MS = 60_000;

interface ProfileQuickPickItem extends vscode.QuickPickItem {
  profile?: CodexProfile;
  action?: "add";
}

function normalized(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function currentCodexHome(): string {
  return path.resolve(process.env.CODEX_HOME ?? path.join(homedir(), ".codex"));
}

async function spawned(child: ReturnType<typeof spawn>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timed out while starting the child process")),
      5_000,
    );
    child.once("spawn", () => {
      clearTimeout(timer);
      resolve();
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

class ProfileController implements vscode.Disposable {
  private readonly statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    25,
  );
  private profiles: CodexProfile[];
  private usage?: CodexUsage;
  private usageCheckedAt?: Date;
  private usageError?: string;
  private refreshInFlight?: Promise<void>;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.profiles = context.globalState.get<CodexProfile[]>(PROFILES_KEY, []);
    this.statusBar.command = "codexAccountSwitcher.switchAccount";
    this.statusBar.name = "Codex account";
    this.statusBar.show();
  }

  dispose(): void {
    this.statusBar.dispose();
  }

  registerCommands(): vscode.Disposable[] {
    return [
      vscode.commands.registerCommand("codexAccountSwitcher.addAccount", () => this.addAccount()),
      vscode.commands.registerCommand("codexAccountSwitcher.registerCurrent", () => this.registerCurrent()),
      vscode.commands.registerCommand("codexAccountSwitcher.switchAccount", () => this.switchAccount()),
      vscode.commands.registerCommand("codexAccountSwitcher.removeProfile", () => this.removeProfile()),
      vscode.commands.registerCommand("codexAccountSwitcher.refresh", () => this.refresh()),
    ];
  }

  async refresh(): Promise<void> {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }
    const refresh = this.performRefresh();
    this.refreshInFlight = refresh;
    try {
      await refresh;
    } finally {
      if (this.refreshInFlight === refresh) {
        this.refreshInFlight = undefined;
      }
    }
  }

  private async performRefresh(): Promise<void> {
    const home = currentCodexHome();
    const active = this.profiles.find((profile) => normalized(profile.codexHome) === normalized(home));
    const identity = await readCodexIdentity(authJsonPath(home));
    const configuration = vscode.workspace.getConfiguration("codexAccountSwitcher");
    const showEmail = configuration.get<boolean>("showEmail", true);
    const label = showEmail ? identity.email ?? active?.name : active?.name ?? identity.email;
    await this.refreshUsage(home, identity, configuration);
    const usagePresentation = this.usage ? presentUsage(this.usage) : undefined;
    const isApiKey = identity.authMode?.toLowerCase().includes("api") ?? false;
    const usageLabel = usagePresentation?.status ?? (isApiKey ? "$(key) API" : "$(pulse) n/a");

    this.statusBar.text = `$(account) Codex: ${label ?? "not signed in"}${identity.email || identity.authMode ? ` · ${usageLabel}` : ""}`;
    const tooltipLines = [
      `**Codex account:** ${identity.email ?? active?.name ?? "Not identified"}`,
      "",
      `**Profile:** ${active?.name ?? "Unregistered default"}`,
    ];
    if (this.usage?.planType) {
      tooltipLines.push("", `**Plan:** ${this.usage.planType.replaceAll("_", " ")}`);
    }
    if (usagePresentation && usagePresentation.details.length > 0) {
      tooltipLines.push("", ...usagePresentation.details.flatMap((line) => [line, ""]).slice(0, -1));
    } else if (isApiKey) {
      tooltipLines.push("", "**Usage:** API-key billing; subscription windows are not available.");
    } else if (identity.email || identity.authMode) {
      tooltipLines.push("", `**Usage:** Unavailable${this.usageError ? ` — ${this.usageError}` : ""}`);
    }
    if (this.usageCheckedAt) {
      tooltipLines.push("", `**Last checked:** ${this.usageCheckedAt.toLocaleString()}`);
    }
    tooltipLines.push(
      "",
      `**CODEX_HOME:** \`${home}\``,
      "",
      "Click to switch account or add a new one.",
    );
    this.statusBar.tooltip = new vscode.MarkdownString(
      tooltipLines.join("\n"),
    );
    this.statusBar.backgroundColor = !identity.email && !identity.authMode
      ? new vscode.ThemeColor("statusBarItem.warningBackground")
      : this.usage?.rateLimitReachedType
        ? new vscode.ThemeColor("statusBarItem.errorBackground")
        : undefined;
  }

  private async refreshUsage(
    home: string,
    identity: CodexIdentity,
    configuration: vscode.WorkspaceConfiguration,
  ): Promise<void> {
    this.usage = undefined;
    this.usageError = undefined;
    this.usageCheckedAt = undefined;
    if (!identity.email && !identity.authMode) {
      return;
    }

    const configuredExecutable = configuration.get<string>("codexExecutable", "codex");
    const executable = await resolveExecutable(configuredExecutable);
    if (!executable) {
      this.usageError = "Codex CLI was not found.";
      return;
    }

    let invocation: { command: string; args: string[] };
    try {
      invocation = process.platform === "win32"
        ? windowsCommandInvocation(executable, ["app-server", "--stdio"])
        : { command: executable, args: ["app-server", "--stdio"] };
    } catch (error) {
      this.usageError = String(error);
      return;
    }

    const result = await queryCodexUsage(invocation.command, invocation.args, home);
    this.usage = result.usage;
    this.usageError = result.error ?? (result.usage ? undefined : "No limit data was returned.");
    this.usageCheckedAt = new Date();
  }

  private async persist(): Promise<void> {
    await this.context.globalState.update(PROFILES_KEY, this.profiles);
  }

  private async askName(prompt: string): Promise<string | undefined> {
    const value = await vscode.window.showInputBox({
      prompt,
      placeHolder: "Personal, Work, Client…",
      validateInput: (candidate) => validateProfileName(candidate, this.profiles),
    });
    return value?.trim();
  }

  private async askCodexHome(name: string): Promise<string | undefined> {
    const defaultHome = defaultCodexHome(name);
    const value = await vscode.window.showInputBox({
      prompt: "Choose the CODEX_HOME directory, or leave empty to use the default",
      placeHolder: defaultHome,
      validateInput: validateCodexHomeInput,
    });
    if (value === undefined) {
      return undefined;
    }
    return resolveCodexHome(value, name);
  }

  private hasHome(codexHome: string): boolean {
    return this.profiles.some(
      (profile) => normalized(profile.codexHome) === normalized(codexHome),
    );
  }

  private async registerCurrent(): Promise<void> {
    const home = currentCodexHome();
    if (this.hasHome(home)) {
      void vscode.window.showInformationMessage("The current CODEX_HOME is already registered.");
      return;
    }

    if (!(await fileExists(authJsonPath(home)))) {
      void vscode.window.showWarningMessage(
        "No auth.json was found in the current CODEX_HOME. Sign in to Codex first.",
      );
      return;
    }

    const identity = await readCodexIdentity(authJsonPath(home));
    const name = await this.askName(`Name the current Codex account${identity.email ? ` (${identity.email})` : ""}`);
    if (!name) {
      return;
    }

    this.profiles.push({
      id: crypto.randomUUID(),
      name,
      codexHome: home,
      createdAt: new Date().toISOString(),
      managed: false,
    });
    await this.persist();
    await this.refresh();
  }

  private async addAccount(): Promise<void> {
    const name = await this.askName("Choose a local name for the new Codex account");
    if (!name) {
      return;
    }

    const codexHome = await this.askCodexHome(name);
    if (!codexHome) {
      return;
    }
    if (this.hasHome(codexHome)) {
      void vscode.window.showErrorMessage("This CODEX_HOME is already registered to another profile.");
      return;
    }

    const configuration = vscode.workspace.getConfiguration("codexAccountSwitcher");
    const configuredExecutable = configuration.get<string>("codexExecutable", "codex");
    const useDeviceAuth = configuration.get<boolean>("useDeviceAuth", false);
    const executable = await resolveExecutable(configuredExecutable);
    if (!executable) {
      const action = await vscode.window.showErrorMessage(
        `Could not find the Codex CLI executable “${configuredExecutable}”.`,
        "Open Settings",
      );
      if (action === "Open Settings") {
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "codexAccountSwitcher.codexExecutable",
        );
      }
      return;
    }

    await ensureFileCredentialStorage(codexHome);
    const id = crypto.randomUUID();

    const loginArgs = useDeviceAuth ? ["login", "--device-auth"] : ["login"];
    const invocation = process.platform === "win32"
      ? windowsCommandInvocation(executable, loginArgs)
      : { command: executable, args: loginArgs };
    const output = vscode.window.createOutputChannel(`Codex login: ${name}`);
    this.context.subscriptions.push(output);
    output.appendLine(`Starting Codex login for profile “${name}”…`);
    output.show(true);

    let loginProcess: ReturnType<typeof spawn>;
    try {
      loginProcess = spawn(invocation.command, invocation.args, {
        cwd: homedir(),
        env: { ...process.env, CODEX_HOME: codexHome },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      loginProcess.stdout?.on("data", (chunk: Buffer) => output.append(chunk.toString("utf8")));
      loginProcess.stderr?.on("data", (chunk: Buffer) => output.append(chunk.toString("utf8")));
      await spawned(loginProcess);
    } catch (error) {
      output.appendLine(`\nCould not start Codex login: ${String(error)}`);
      void vscode.window.showErrorMessage(`Could not start Codex login: ${String(error)}`);
      return;
    }

    const authenticated = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Waiting for Codex login for “${name}”…`,
        cancellable: true,
      },
      async (_progress, token) => {
        const deadline = Date.now() + 10 * 60_000;
        while (!token.isCancellationRequested && Date.now() < deadline) {
          if (await fileExists(authJsonPath(codexHome))) {
            return true;
          }
          if (loginProcess.exitCode !== null) {
            return false;
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
        }
        if (token.isCancellationRequested && loginProcess.exitCode === null) {
          loginProcess.kill();
        }
        return false;
      },
    );

    if (!authenticated) {
      void vscode.window.showWarningMessage(
        "Codex login was not detected. The unfinished profile was not registered.",
      );
      return;
    }

    this.profiles.push({
      id,
      name,
      codexHome,
      createdAt: new Date().toISOString(),
      managed: true,
    });
    await this.persist();

    const identity = await readCodexIdentity(authJsonPath(codexHome));
    const action = await vscode.window.showInformationMessage(
      `Codex account ${identity.email ?? name} is ready.`,
      "Switch now",
    );
    if (action === "Switch now") {
      await this.restartWithProfile(this.profiles.at(-1)!);
    }
  }

  private async identityFor(profile: CodexProfile): Promise<CodexIdentity> {
    return readCodexIdentity(authJsonPath(profile.codexHome));
  }

  private async chooseProfile(
    placeHolder: string,
    includeAddAccount = false,
  ): Promise<CodexProfile | undefined> {
    if (this.profiles.length === 0) {
      const action = await vscode.window.showInformationMessage(
        "No Codex account profiles are registered yet.",
        "Register current",
        "Add account",
      );
      if (action === "Register current") {
        await this.registerCurrent();
      } else if (action === "Add account") {
        await this.addAccount();
      }
      return undefined;
    }

    const activeHome = normalized(currentCodexHome());
    const profileItems: ProfileQuickPickItem[] = await Promise.all(this.profiles.map(async (profile) => {
      const identity = await this.identityFor(profile);
      const active = normalized(profile.codexHome) === activeHome;
      return {
        label: `${active ? "$(check) " : "$(account) "}${identity.email ?? profile.name}`,
        description: identity.email ? profile.name : undefined,
        detail: profile.codexHome,
        profile,
      };
    }));

    const items: ProfileQuickPickItem[] = [...profileItems];
    if (includeAddAccount) {
      items.push(
        { label: "Accounts", kind: vscode.QuickPickItemKind.Separator },
        {
          label: "$(add) Add a new Codex account",
          detail: "Create an isolated profile and authenticate it",
          action: "add",
        },
      );
    }

    const selected = await vscode.window.showQuickPick(items, { placeHolder });
    if (selected?.action === "add") {
      await this.addAccount();
      return undefined;
    }
    return selected?.profile;
  }

  private async switchAccount(): Promise<void> {
    const selected = await this.chooseProfile(
      "Select the Codex account for this VS Code instance",
      true,
    );
    if (!selected) {
      return;
    }
    if (normalized(selected.codexHome) === normalized(currentCodexHome())) {
      void vscode.window.showInformationMessage(`${selected.name} is already active.`);
      return;
    }
    await this.restartWithProfile(selected);
  }

  private async restartWithProfile(profile: CodexProfile): Promise<void> {
    if (!(await fileExists(authJsonPath(profile.codexHome)))) {
      void vscode.window.showErrorMessage(
        `The profile “${profile.name}” has no auth.json. Authenticate it again or forget it.`,
      );
      return;
    }

    const configuration = vscode.workspace.getConfiguration("codexAccountSwitcher");
    const configuredLauncher = configuration.get<string>("vscodeExecutable", "");
    const appExecutable = await resolveVsCodeLauncher(vscode.env.appRoot, configuredLauncher);
    if (!appExecutable) {
      const action = await vscode.window.showErrorMessage(
        "Could not locate the VS Code CLI launcher required for restart.",
        "Open Settings",
      );
      if (action === "Open Settings") {
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "codexAccountSwitcher.vscodeExecutable",
        );
      }
      return;
    }
    const confirm = configuration.get<boolean>("confirmBeforeRestart", true);
    if (confirm) {
      const choice = await vscode.window.showWarningMessage(
        `Switch to “${profile.name}”? All VS Code windows must close so the new CODEX_HOME can take effect. VS Code will restore the selected workspace.`,
        { modal: true },
        "Switch and Restart",
      );
      if (choice !== "Switch and Restart") {
        return;
      }
    }

    const payload: RelaunchPayload = {
      appExecutable,
      codexHome: profile.codexHome,
      // Waiting for the extension host is sufficient. On Windows its parent can
      // remain alive during shutdown and would prevent the helper from ever
      // reaching the relaunch step.
      parentPids: [process.pid],
      launchArguments: buildLaunchArguments(vscode.workspace.workspaceFile, vscode.workspace.workspaceFolders),
      waitTimeoutMs: RESTART_TIMEOUT_MS,
    };
    const helperPath = path.join(this.context.extensionPath, "out", "src", "relauncher.js");

    try {
      const helper = spawn(process.execPath, [helperPath, JSON.stringify(payload)], {
        detached: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        stdio: "ignore",
        windowsHide: true,
      });
      await spawned(helper);
      helper.unref();
    } catch (error) {
      void vscode.window.showErrorMessage(`Could not prepare the VS Code restart: ${String(error)}`);
      return;
    }

    await vscode.commands.executeCommand("workbench.action.quit");
  }

  private async removeProfile(): Promise<void> {
    const selected = await this.chooseProfile("Choose a profile to forget");
    if (!selected) {
      return;
    }

    const choice = await vscode.window.showWarningMessage(
      `Forget “${selected.name}”? Its files and credentials will not be deleted.`,
      { modal: true },
      "Forget Profile",
    );
    if (choice !== "Forget Profile") {
      return;
    }

    this.profiles = this.profiles.filter((profile) => profile.id !== selected.id);
    await this.persist();
    await this.refresh();
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const controller = new ProfileController(context);
  context.subscriptions.push(controller, ...controller.registerCommands());
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration("codexAccountSwitcher.showEmail")
        || event.affectsConfiguration("codexAccountSwitcher.codexExecutable")
      ) {
        void controller.refresh();
      }
    }),
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        void controller.refresh();
      }
    }),
  );
  const authWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(currentCodexHome(), "auth.json"),
  );
  context.subscriptions.push(
    authWatcher,
    authWatcher.onDidCreate(() => void controller.refresh()),
    authWatcher.onDidChange(() => void controller.refresh()),
    authWatcher.onDidDelete(() => void controller.refresh()),
  );
  const usageTimer = setInterval(() => void controller.refresh(), USAGE_REFRESH_INTERVAL_MS);
  context.subscriptions.push({ dispose: () => clearInterval(usageTimer) });
  await controller.refresh();
}

export function deactivate(): void {}
