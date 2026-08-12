import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ensureFileCredentialStorage, FILE_CREDENTIAL_SETTING } from "../src/profileFiles.js";

test("creates a profile configured for isolated file credentials", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "codex-switcher-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  await ensureFileCredentialStorage(root);
  assert.equal(await readFile(path.join(root, "config.toml"), "utf8"), `${FILE_CREDENTIAL_SETTING}\n`);
});

test("preserves existing config and remains idempotent", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "codex-switcher-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const { writeFile } = await import("node:fs/promises");
  await writeFile(path.join(root, "config.toml"), "model = \"gpt-test\"\n");
  await ensureFileCredentialStorage(root);
  await ensureFileCredentialStorage(root);

  const config = await readFile(path.join(root, "config.toml"), "utf8");
  assert.equal(config, `model = \"gpt-test\"\n${FILE_CREDENTIAL_SETTING}\n`);
});
