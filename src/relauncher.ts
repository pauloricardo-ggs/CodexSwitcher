import { spawn } from "node:child_process";
import { windowsCommandInvocation } from "./executable.js";
import type { RelaunchPayload } from "./types.js";

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function waitUntilStopped(pids: readonly number[], timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pids.every((pid) => !isProcessAlive(pid))) {
      return true;
    }
    await delay(200);
  }
  return false;
}

function parsePayload(argument: string | undefined): RelaunchPayload {
  if (!argument) {
    throw new Error("Missing relaunch payload");
  }
  return JSON.parse(argument) as RelaunchPayload;
}

async function main(): Promise<void> {
  const payload = parsePayload(process.argv[2]);
  const stopped = await waitUntilStopped(payload.parentPids, payload.waitTimeoutMs);
  if (!stopped) {
    return;
  }

  // Let OS-level locks and the VS Code IPC endpoint settle before relaunching.
  await delay(700);

  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    CODEX_HOME: payload.codexHome,
  };

  let invocation: { command: string; args: string[] };
  if (process.platform === "win32" && payload.windowsCliPath) {
    // This is the same bootstrap used by VS Code's code.cmd, without relying on
    // cmd.exe quoting. The CLI removes ELECTRON_RUN_AS_NODE before it starts the
    // GUI and also normalizes Windows URI arguments before passing them on.
    environment.ELECTRON_RUN_AS_NODE = "1";
    delete environment.VSCODE_DEV;
    invocation = {
      command: payload.appExecutable,
      args: [payload.windowsCliPath, ...payload.launchArguments],
    };
  } else {
    delete environment.ELECTRON_RUN_AS_NODE;
    invocation = process.platform === "win32"
      ? windowsCommandInvocation(payload.appExecutable, payload.launchArguments)
      : { command: payload.appExecutable, args: payload.launchArguments };
  }
  const child = spawn(invocation.command, invocation.args, {
    detached: true,
    env: environment,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
}

void main().catch(() => {
  // The helper is detached and has no safe UI channel. Fail closed: never
  // launch with a partial or malformed profile selection.
  process.exitCode = 1;
});
