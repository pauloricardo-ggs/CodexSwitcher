import { readFile } from "node:fs/promises";
import type { CodexIdentity } from "./types.js";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

/**
 * Reads a JWT payload without verifying its signature. This is intentionally
 * suitable only for a display label; it must never be used for authorization.
 */
export function decodeJwtPayload(token: unknown): UnknownRecord | undefined {
  if (typeof token !== "string") {
    return undefined;
  }

  const segments = token.split(".");
  const encodedPayload = segments[1];
  if (!encodedPayload) {
    return undefined;
  }

  try {
    return asRecord(JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")));
  } catch {
    return undefined;
  }
}

export function identityFromAuthJson(value: unknown): CodexIdentity {
  const root = asRecord(value);
  const tokens = asRecord(root?.tokens);
  const idPayload = decodeJwtPayload(tokens?.id_token);
  const accessPayload = decodeJwtPayload(tokens?.access_token);
  const profile = asRecord(accessPayload?.["https://api.openai.com/profile"]);
  const auth = asRecord(
    accessPayload?.["https://api.openai.com/auth"] ??
      idPayload?.["https://api.openai.com/auth"],
  );

  return {
    email: asNonEmptyString(idPayload?.email) ?? asNonEmptyString(profile?.email),
    name: asNonEmptyString(idPayload?.name) ?? asNonEmptyString(profile?.name),
    accountId:
      asNonEmptyString(auth?.chatgpt_account_id) ??
      asNonEmptyString(tokens?.account_id),
    authMode: asNonEmptyString(root?.auth_mode),
  };
}

export async function readCodexIdentity(authJsonPath: string): Promise<CodexIdentity> {
  try {
    const contents = await readFile(authJsonPath, "utf8");
    return identityFromAuthJson(JSON.parse(contents));
  } catch {
    return {};
  }
}
