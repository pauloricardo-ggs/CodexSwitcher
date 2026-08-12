import assert from "node:assert/strict";
import test from "node:test";
import { buildLaunchArguments } from "../src/relaunchPlan.js";

function uri(scheme: string, fsPath: string, serialized: string) {
  return { scheme, fsPath, toString: () => serialized };
}

test("reopens a local workspace file", () => {
  assert.deepEqual(
    buildLaunchArguments(uri("file", "/repo/project.code-workspace", "file:///repo/project.code-workspace"), undefined),
    ["--new-window", "/repo/project.code-workspace"],
  );
});

test("reopens a remote folder by URI", () => {
  assert.deepEqual(
    buildLaunchArguments(undefined, [{ uri: uri("vscode-remote", "/repo", "vscode-remote://ssh-remote/repo") }]),
    ["--new-window", "--folder-uri", "vscode-remote://ssh-remote/repo"],
  );
});

test("starts an empty window when no workspace is open", () => {
  assert.deepEqual(buildLaunchArguments(undefined, undefined), ["--new-window"]);
});
