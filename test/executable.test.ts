import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  resolveExecutable,
  resolveVsCodeLauncher,
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
