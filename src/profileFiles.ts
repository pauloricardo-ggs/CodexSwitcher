import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const FILE_CREDENTIAL_SETTING = 'cli_auth_credentials_store = "file"';

export function authJsonPath(codexHome: string): string {
  return path.join(codexHome, "auth.json");
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates a profile home and ensures that credentials remain inside it.
 * Existing configuration is preserved byte-for-byte except for appending the
 * missing setting.
 */
export async function ensureFileCredentialStorage(codexHome: string): Promise<void> {
  await mkdir(codexHome, { recursive: true, mode: 0o700 });
  const configPath = path.join(codexHome, "config.toml");

  let current = "";
  try {
    current = await readFile(configPath, "utf8");
  } catch {
    // A new profile has no configuration yet.
  }

  if (/^\s*cli_auth_credentials_store\s*=/m.test(current)) {
    return;
  }

  const separator = current.length === 0 || current.endsWith("\n") ? "" : "\n";
  const updated = `${current}${separator}${FILE_CREDENTIAL_SETTING}\n`;
  await writeFile(configPath, updated, { encoding: "utf8", mode: 0o600 });
}
