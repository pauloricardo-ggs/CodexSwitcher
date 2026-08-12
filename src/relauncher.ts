import { spawn } from "node:child_process";
import { buildRelaunchInvocation } from "./relaunchInvocation.js";
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
  // Windows generally takes longer to release the instance mutex.
  await delay(process.platform === "win32" ? 2_000 : 700);

  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    CODEX_HOME: payload.codexHome,
  };

  // The helper itself runs with ELECTRON_RUN_AS_NODE, but the relaunched
  // Code.exe must start in its normal GUI mode. Calling VS Code's internal
  // cli.js bootstrap here is brittle and can leave Windows with no GUI process.
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.VSCODE_DEV;
  const invocation = buildRelaunchInvocation(payload);
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
