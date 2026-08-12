import { homedir } from "node:os";
import path from "node:path";
import type { CodexProfile } from "./types.js";

const PROFILE_NAME_PATTERN = /^[A-Za-z0-9 _-]+$/;
const HOME_PREFIX_PATTERN = /^~[\\/]/;
const WINDOWS_RESERVED_NAME_PATTERN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function validateProfileName(
  value: string,
  profiles: readonly CodexProfile[],
): string | undefined {
  const name = value.trim();
  if (name.length === 0) {
    return "Enter a profile name.";
  }
  if (!PROFILE_NAME_PATTERN.test(name)) {
    return "Use only letters without accents, numbers, spaces, hyphens, and underscores.";
  }
  if (WINDOWS_RESERVED_NAME_PATTERN.test(name)) {
    return "This name is reserved by the operating system. Choose another profile name.";
  }
  const normalizedName = normalizeProfileName(name);
  if (profiles.some((profile) => normalizeProfileName(profile.name) === normalizedName)) {
    return "A profile with this name already exists.";
  }
  return undefined;
}

export function normalizeProfileName(profileName: string): string {
  return profileName.trim().toLowerCase().replaceAll(" ", "_");
}

export function defaultCodexHome(profileName: string): string {
  return path.join(homedir(), `.codex_${normalizeProfileName(profileName)}`);
}

export function resolveCodexHome(value: string, profileName: string): string {
  const candidate = value.trim();
  if (candidate.length === 0) {
    return defaultCodexHome(profileName);
  }
  if (candidate === "~") {
    return homedir();
  }
  if (HOME_PREFIX_PATTERN.test(candidate)) {
    return path.resolve(homedir(), candidate.slice(2));
  }
  return path.resolve(candidate);
}

export function validateCodexHomeInput(value: string): string | undefined {
  const candidate = value.trim();
  if (candidate.length === 0 || candidate === "~") {
    return undefined;
  }
  if (candidate.startsWith("~") && !HOME_PREFIX_PATTERN.test(candidate)) {
    return "Use an absolute path or a path beginning with ~/ (leave empty for the default).";
  }
  if (HOME_PREFIX_PATTERN.test(candidate)) {
    return undefined;
  }
  if (!path.isAbsolute(candidate)) {
    return "Use an absolute path or a path beginning with ~/ (leave empty for the default).";
  }
  return undefined;
}
