import { windowsCommandInvocation } from "./executable.js";
import type { RelaunchPayload } from "./types.js";

export function buildRelaunchInvocation(
  payload: Pick<RelaunchPayload, "appExecutable" | "launchArguments">,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } {
  return platform === "win32"
    ? windowsCommandInvocation(payload.appExecutable, payload.launchArguments)
    : { command: payload.appExecutable, args: [...payload.launchArguments] };
}
