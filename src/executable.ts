import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

function candidateExtensions(platform: NodeJS.Platform): string[] {
  if (platform !== "win32") {
    return [""];
  }
  const pathExt = process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";
  return ["", ...pathExt.split(";").map((value) => value.toLowerCase())];
}

async function isExecutable(filePath: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    await access(filePath, platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolveExecutable(
  configured: string,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> {
  const value = configured.trim();
  if (!value || value.includes('"')) {
    return undefined;
  }

  const hasPath = path.isAbsolute(value) || value.includes("/") || value.includes("\\");
  const directories = hasPath ? [""] : (environment.PATH ?? "").split(path.delimiter).filter(Boolean);
  const extensions = candidateExtensions(platform);

  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = directory ? path.join(directory, value) : value;
      const hasKnownExtension = platform === "win32" && path.extname(candidate).length > 0;
      const resolved = path.resolve(hasKnownExtension ? candidate : `${candidate}${extension}`);
      if (await isExecutable(resolved, platform)) {
        return resolved;
      }
    }
  }

  return undefined;
}

export function windowsCommandInvocation(
  executable: string,
  args: readonly string[],
  comSpec = process.env.ComSpec ?? "cmd.exe",
): { command: string; args: string[] } {
  if (!/[.]cmd$|[.]bat$/i.test(executable)) {
    return { command: executable, args: [...args] };
  }
  if ([executable, ...args].some((value) => value.includes('"'))) {
    throw new Error("Executable path or argument contains an unsupported quote character");
  }

  const commandLine = `""${executable}"${args.map((value) => ` "${value}"`).join("")}"`;
  return { command: comSpec, args: ["/d", "/s", "/c", commandLine] };
}

export async function resolveVsCodeLauncher(
  appRoot: string,
  configured: string,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> {
  if (configured.trim().length > 0) {
    return resolveExecutable(configured, environment, platform);
  }

  try {
    const product = JSON.parse(await readFile(path.join(appRoot, "product.json"), "utf8")) as {
      applicationName?: unknown;
    };
    const applicationName = typeof product.applicationName === "string"
      ? product.applicationName
      : undefined;
    if (!applicationName || !/^[a-zA-Z0-9._-]+$/.test(applicationName)) {
      return undefined;
    }

    const launcher = path.join(
      appRoot,
      "bin",
      platform === "win32" ? `${applicationName}.cmd` : applicationName,
    );
    return await isExecutable(launcher, platform) ? launcher : undefined;
  } catch {
    return undefined;
  }
}
