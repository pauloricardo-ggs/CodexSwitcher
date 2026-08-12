import assert from "node:assert/strict";
import test from "node:test";
import { buildRelaunchInvocation } from "../src/relaunchInvocation.js";

test("relaunches the Windows GUI executable directly", () => {
  assert.deepEqual(buildRelaunchInvocation({
    appExecutable: "C:\\Program Files\\Microsoft VS Code\\Code.exe",
    launchArguments: ["--new-window", "C:\\work\\project"],
  }, "win32"), {
    command: "C:\\Program Files\\Microsoft VS Code\\Code.exe",
    args: ["--new-window", "C:\\work\\project"],
  });
});
