import assert from "node:assert/strict";
import { homedir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  defaultCodexHome,
  resolveCodexHome,
  validateCodexHomeInput,
  validateProfileName,
} from "../src/profileValidation.js";
import type { CodexProfile } from "../src/types.js";

const existing: CodexProfile = {
  id: "1",
  name: "Work Account",
  codexHome: "/profiles/work",
  createdAt: "2026-01-01T00:00:00.000Z",
  managed: true,
};

test("accepts folder-safe unique profile names", () => {
  assert.equal(validateProfileName("personal_2-test", [existing]), undefined);
  assert.match(validateProfileName("work account", [existing]) ?? "", /already exists/);
  assert.match(validateProfileName("work_account", [existing]) ?? "", /already exists/);
  assert.match(validateProfileName("WORK_ACCOUNT", [existing]) ?? "", /already exists/);
  assert.equal(validateProfileName("workaccount", [existing]), undefined);
  assert.match(validateProfileName("João", [] ) ?? "", /only letters/);
  assert.equal(validateProfileName("my profile", []), undefined);
  assert.match(validateProfileName("work.account", []) ?? "", /only letters/);
  assert.match(validateProfileName("CON", []) ?? "", /reserved/);
});

test("uses a predictable home directory when the path is empty", () => {
  assert.equal(defaultCodexHome("Work Account"), path.join(homedir(), ".codex_work_account"));
  assert.equal(resolveCodexHome("", "Work Account"), path.join(homedir(), ".codex_work_account"));
  assert.equal(defaultCodexHome("WorkAccount"), path.join(homedir(), ".codex_workaccount"));
});

test("accepts absolute and home-relative paths but rejects relative paths", () => {
  const absolute = path.join(path.parse(process.cwd()).root, "codex", "work");
  assert.equal(validateCodexHomeInput(absolute), undefined);
  assert.equal(validateCodexHomeInput(`~${path.sep}codex-work`), undefined);
  assert.match(validateCodexHomeInput("codex-work") ?? "", /absolute path/);
  assert.equal(resolveCodexHome(`~${path.sep}codex-work`, "work"), path.join(homedir(), "codex-work"));
});
