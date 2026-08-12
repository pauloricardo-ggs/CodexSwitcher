import { spawn } from "node:child_process";
import type {
  CodexCredits,
  CodexSpendLimit,
  CodexUsage,
  CodexUsageWindow,
} from "./types.js";

type UnknownRecord = Record<string, unknown>;

export interface UsageQueryResult {
  usage?: CodexUsage;
  error?: string;
}

export interface UsagePresentation {
  status: string;
  details: string[];
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function first(record: UnknownRecord, camelCase: string, snakeCase: string): unknown {
  return record[camelCase] ?? record[snakeCase];
}

function parseWindow(value: unknown): CodexUsageWindow | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const usedPercent = asNumber(first(record, "usedPercent", "used_percent"));
  if (usedPercent === undefined) {
    return undefined;
  }
  return {
    usedPercent: Math.max(0, Math.min(100, Math.round(usedPercent))),
    windowDurationMins: asNumber(first(record, "windowDurationMins", "window_duration_mins")),
    resetsAt: asNumber(first(record, "resetsAt", "resets_at")),
  };
}

function parseCredits(value: unknown): CodexCredits | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const hasCredits = asBoolean(first(record, "hasCredits", "has_credits"));
  const unlimited = asBoolean(record.unlimited);
  if (hasCredits === undefined || unlimited === undefined) {
    return undefined;
  }
  return {
    balance: asString(record.balance),
    hasCredits,
    unlimited,
  };
}

function parseSpendLimit(value: unknown): CodexSpendLimit | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const limit = asString(record.limit);
  const used = asString(record.used);
  const remainingPercent = asNumber(first(record, "remainingPercent", "remaining_percent"));
  const resetsAt = asNumber(first(record, "resetsAt", "resets_at"));
  if (!limit || !used || remainingPercent === undefined || resetsAt === undefined) {
    return undefined;
  }
  return {
    limit,
    used,
    remainingPercent: Math.max(0, Math.min(100, Math.round(remainingPercent))),
    resetsAt,
  };
}

function parseSnapshot(value: unknown): CodexUsage | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const usage: CodexUsage = {
    limitId: asString(first(record, "limitId", "limit_id")),
    limitName: asString(first(record, "limitName", "limit_name")),
    planType: asString(first(record, "planType", "plan_type")),
    primary: parseWindow(record.primary),
    secondary: parseWindow(record.secondary),
    credits: parseCredits(record.credits),
    individualLimit: parseSpendLimit(first(record, "individualLimit", "individual_limit")),
    rateLimitReachedType: asString(first(record, "rateLimitReachedType", "rate_limit_reached_type")),
  };

  return Object.values(usage).some((entry) => entry !== undefined) ? usage : undefined;
}

/** Normalizes both current camelCase and older snake_case app-server payloads. */
export function usageFromRateLimitsResponse(value: unknown): CodexUsage | undefined {
  const root = asRecord(value);
  if (!root) {
    return undefined;
  }

  const byId = asRecord(first(root, "rateLimitsByLimitId", "rate_limits_by_limit_id"));
  const codexBucket = parseSnapshot(byId?.codex);
  if (codexBucket) {
    return codexBucket;
  }

  const historical = parseSnapshot(first(root, "rateLimits", "rate_limits"));
  if (historical) {
    return historical;
  }

  if (byId) {
    for (const bucket of Object.values(byId)) {
      const parsed = parseSnapshot(bucket);
      if (parsed) {
        return parsed;
      }
    }
  }
  return undefined;
}

function durationLabel(minutes?: number): string {
  if (minutes === undefined || minutes <= 0) {
    return "Plan";
  }
  if (minutes < 60) {
    return `${Math.round(minutes)}m`;
  }
  if (minutes < 1_440) {
    return `${Math.round(minutes / 60)}h`;
  }
  return `${Math.round(minutes / 1_440)}d`;
}

function durationDescription(minutes?: number): string {
  if (minutes === undefined || minutes <= 0) {
    return "Plan limit";
  }
  if (minutes < 60) {
    return `${Math.round(minutes)}-minute limit`;
  }
  if (minutes < 1_440) {
    return `${Math.round(minutes / 60)}-hour limit`;
  }
  const days = Math.round(minutes / 1_440);
  if (days === 1) {
    return "Daily limit";
  }
  if (days === 7) {
    return "Weekly limit";
  }
  return `${days}-day limit`;
}

function dateFromTimestamp(timestamp: number): Date {
  return new Date(timestamp > 10_000_000_000 ? timestamp : timestamp * 1_000);
}

export function formatReset(timestamp: number, now = Date.now()): string {
  const reset = dateFromTimestamp(timestamp);
  if (Number.isNaN(reset.getTime())) {
    return "unknown time";
  }

  const remainingMs = reset.getTime() - now;
  let relative: string;
  if (remainingMs <= 0) {
    relative = "now";
  } else if (remainingMs < 60 * 60_000) {
    relative = `in ${Math.max(1, Math.ceil(remainingMs / 60_000))} min`;
  } else if (remainingMs < 48 * 60 * 60_000) {
    relative = `in ${Math.ceil(remainingMs / (60 * 60_000))} h`;
  } else {
    relative = `in ${Math.ceil(remainingMs / (24 * 60 * 60_000))} days`;
  }

  const absolute = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(reset);
  return `${absolute} (${relative})`;
}

function windowDetails(window: CodexUsageWindow): string[] {
  const result = [
    `**${durationDescription(window.windowDurationMins)}:** ${window.usedPercent}% used · ${100 - window.usedPercent}% remaining`,
  ];
  if (window.resetsAt !== undefined) {
    result.push(`Resets ${formatReset(window.resetsAt)}`);
  }
  return result;
}

function formatCredits(value: string): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toFixed(2) : value;
}

export function presentUsage(usage: CodexUsage): UsagePresentation {
  const details: string[] = [];

  if (usage.individualLimit) {
    const usedPercent = 100 - usage.individualLimit.remainingPercent;
    details.push(
      `**Workspace limit:** ${usage.individualLimit.used} / ${usage.individualLimit.limit} · ${usage.individualLimit.remainingPercent}% remaining`,
      `Resets ${formatReset(usage.individualLimit.resetsAt)}`,
    );
    if (usage.credits) {
      details.push(usage.credits.unlimited
        ? "**Credits:** Unlimited"
        : `**Credits available:** ${usage.credits.balance !== undefined
          ? formatCredits(usage.credits.balance)
          : (usage.credits.hasCredits ? "Yes" : "No")}`);
    }
    return { status: `$(dashboard) ${usedPercent}% budget`, details };
  }

  if (usage.credits?.unlimited) {
    details.push("**Credits:** Unlimited");
  } else if (usage.credits?.balance) {
    details.push(`**Credits available:** ${formatCredits(usage.credits.balance)}`);
  } else if (usage.credits && !usage.credits.hasCredits) {
    details.push("**Credits available:** None");
  }

  const windows = [usage.primary, usage.secondary].filter(
    (window): window is CodexUsageWindow => window !== undefined,
  );
  for (const window of windows) {
    details.push(...windowDetails(window));
  }

  if (usage.rateLimitReachedType) {
    details.push(`**Limit status:** ${usage.rateLimitReachedType.replaceAll("_", " ")}`);
  }

  if (windows.length > 0) {
    return {
      status: windows
        .map((window) => `${durationLabel(window.windowDurationMins)} ${window.usedPercent}%`)
        .join(" · "),
      details,
    };
  }
  if (usage.credits?.unlimited) {
    return { status: "$(infinity) unlimited", details };
  }
  if (usage.credits?.balance) {
    return { status: `$(credit-card) ${formatCredits(usage.credits.balance)} cr`, details };
  }
  return { status: "$(pulse) usage", details };
}

/**
 * Reads the current account limits through Codex's app-server protocol. The
 * child receives only the selected CODEX_HOME and is stopped after one reply.
 */
export async function queryCodexUsage(
  command: string,
  args: readonly string[],
  codexHome: string,
  timeoutMs = 8_000,
): Promise<UsageQueryResult> {
  return new Promise<UsageQueryResult>((resolve) => {
    let settled = false;
    let output = "";
    const child = spawn(command, [...args], {
      env: { ...process.env, CODEX_HOME: codexHome },
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });

    const finish = (result: UsageQueryResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      child.stdin.end();
      if (child.exitCode === null) {
        child.kill();
      }
      resolve(result);
    };

    const send = (message: unknown): void => {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };

    const timer = setTimeout(
      () => finish({ error: "Timed out while reading Codex usage." }),
      timeoutMs,
    );

    child.once("error", (error) => finish({ error: String(error) }));
    child.stdin.once("error", (error) => finish({ error: String(error) }));
    child.once("exit", () => {
      if (!settled) {
        finish({ error: "Codex app-server exited before returning usage." });
      }
    });
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      const lines = output.split(/\r?\n/);
      output = lines.pop() ?? "";
      for (const line of lines) {
        let message: UnknownRecord | undefined;
        try {
          message = asRecord(JSON.parse(line));
        } catch {
          continue;
        }
        if (message?.id === 1 && asRecord(message.error)) {
          finish({ error: asString(asRecord(message.error)?.message) ?? "Codex initialization failed." });
          return;
        }
        if (message?.id === 1) {
          send({ method: "initialized" });
          send({ id: 2, method: "account/rateLimits/read", params: null });
        } else if (message?.id === 2) {
          const rpcError = asRecord(message.error);
          finish(rpcError
            ? { error: asString(rpcError.message) ?? "Codex usage is unavailable." }
            : { usage: usageFromRateLimitsResponse(message.result) });
          return;
        }
      }
    });

    send({
      id: 1,
      method: "initialize",
      params: {
        clientInfo: {
          name: "codex-account-switcher",
          title: "Codex Switcher",
          version: "0.1",
        },
      },
    });
  });
}
