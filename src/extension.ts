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
import type { CodexIdentity, CodexProfile, RelaunchPayload } from "./types.js";

const PROFILES_KEY = "codexAccountSwitcher.profiles.v1";
const RESTART_TIMEOUT_MS = 60_000;

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
    const home = currentCodexHome();
    const active = this.profiles.find((profile) => normalized(profile.codexHome) === normalized(home));
    const identity = await readCodexIdentity(authJsonPath(home));
    const showEmail = vscode.workspace
      .getConfiguration("codexAccountSwitcher")
      .get<boolean>("showEmail", true);
    const label = showEmail ? identity.email ?? active?.name : active?.name ?? identity.email;

    this.statusBar.text = `$(account) Codex: ${label ?? "not signed in"}`;
    this.statusBar.tooltip = new vscode.MarkdownString(
      [
        `**Codex account:** ${identity.email ?? active?.name ?? "Not identified"}`,
        "",
        `**Profile:** ${active?.name ?? "Unregistered default"}`,
        "",
        `**CODEX_HOME:** \`${home}\``,
        "",
        "Click to switch account.",
      ].join("\n"),
    );
    this.statusBar.backgroundColor = identity.email || identity.authMode
      ? undefined
      : new vscode.ThemeColor("statusBarItem.warningBackground");
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

  private async chooseProfile(placeHolder: string): Promise<CodexProfile | undefined> {
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
    const items = await Promise.all(this.profiles.map(async (profile) => {
      const identity = await this.identityFor(profile);
      const active = normalized(profile.codexHome) === activeHome;
      return {
        label: `${active ? "$(check) " : "$(account) "}${identity.email ?? profile.name}`,
        description: identity.email ? profile.name : undefined,
        detail: profile.codexHome,
        profile,
      };
    }));

    return (await vscode.window.showQuickPick(items, { placeHolder }))?.profile;
  }

  private async switchAccount(): Promise<void> {
    const selected = await this.chooseProfile("Select the Codex account for this VS Code instance");
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
      parentPids: [process.pid, process.ppid].filter((pid, index, values) => pid > 0 && values.indexOf(pid) === index),
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
      if (event.affectsConfiguration("codexAccountSwitcher.showEmail")) {
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
  await controller.refresh();
}

export function deactivate(): void {}
