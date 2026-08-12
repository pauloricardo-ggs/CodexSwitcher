import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  resolveExecutable,
  resolveVsCodeLauncher,
  resolveWindowsVsCodeCli,
  windowsCommandInvocation,
} from "../src/executable.js";

test("resolves an executable from PATH", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "codex-switcher-exec-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executable = path.join(root, "codex-test");
  await writeFile(executable, "#!/bin/sh\n");
  await chmod(executable, 0o700);

  assert.equal(await resolveExecutable("codex-test", { PATH: root }, "linux"), executable);
});

test("returns undefined for an unavailable executable", async () => {
  assert.equal(await resolveExecutable("missing-codex", { PATH: "" }, "linux"), undefined);
});

test("wraps Windows command shims without enabling a general shell", () => {
  assert.deepEqual(
    windowsCommandInvocation("C:\\Program Files\\Codex\\codex.cmd", ["login", "--device-auth"], "cmd.exe"),
    {
      command: "cmd.exe",
      args: [
        "/d",
        "/s",
        "/c",
        '""C:\\Program Files\\Codex\\codex.cmd" "login" "--device-auth""',
      ],
    },
  );
});

test("detects the bundled VS Code CLI launcher from appRoot", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "codex-switcher-app-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(bin);
  await writeFile(path.join(root, "product.json"), JSON.stringify({ applicationName: "code-test" }));
  const launcher = path.join(bin, "code-test");
  await writeFile(launcher, "#!/bin/sh\n");
  await chmod(launcher, 0o700);

  assert.equal(await resolveVsCodeLauncher(root, "", {}, "linux"), launcher);
});

test("uses the running VS Code executable for Windows restarts", async (t) => {
  const installRoot = await mkdtemp(path.join(tmpdir(), "codex-switcher-win-app-"));
  t.after(() => rm(installRoot, { recursive: true, force: true }));
  const appRoot = path.join(installRoot, "resources", "app");
  const bin = path.join(appRoot, "bin");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(bin, { recursive: true });
  await writeFile(
    path.join(appRoot, "product.json"),
    JSON.stringify({ applicationName: "code-insiders", nameShort: "Code - Insiders" }),
  );
  const executable = path.join(installRoot, "Code - Insiders.exe");
  const commandShim = path.join(bin, "code-insiders.cmd");
  await writeFile(executable, "");
  await writeFile(commandShim, "");

  assert.equal(await resolveVsCodeLauncher(appRoot, "", {}, "win32", executable), executable);
});

test("falls back to the Windows command shim when no GUI executable is found", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "codex-switcher-win-shim-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(bin);
  await writeFile(path.join(root, "product.json"), JSON.stringify({ applicationName: "code-test" }));
  const launcher = path.join(bin, "code-test.cmd");
  await writeFile(launcher, "");

  assert.equal(await resolveVsCodeLauncher(root, "", {}, "win32", "/not-vscode/node"), launcher);
});

test("finds the official Windows CLI bootstrap for an automatic executable", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "codex-switcher-win-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cliPath = path.join(root, "out", "cli.js");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path.dirname(cliPath), { recursive: true });
  await writeFile(cliPath, "");

  assert.equal(
    await resolveWindowsVsCodeCli(root, "", "C:\\Programs\\VS Code\\Code.exe", "win32"),
    cliPath,
  );
  assert.equal(
    await resolveWindowsVsCodeCli(root, "custom.cmd", "C:\\Programs\\VS Code\\Code.exe", "win32"),
    undefined,
  );
});
