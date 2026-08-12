export interface CodexProfile {
  id: string;
  name: string;
  codexHome: string;
  createdAt: string;
  managed: boolean;
}

export interface CodexIdentity {
  email?: string;
  name?: string;
  accountId?: string;
  authMode?: string;
}

export interface CodexUsageWindow {
  usedPercent: number;
  windowDurationMins?: number;
  resetsAt?: number;
}

export interface CodexCredits {
  balance?: string;
  hasCredits: boolean;
  unlimited: boolean;
}

export interface CodexSpendLimit {
  limit: string;
  used: string;
  remainingPercent: number;
  resetsAt: number;
}

export interface CodexUsage {
  limitId?: string;
  limitName?: string;
  planType?: string;
  primary?: CodexUsageWindow;
  secondary?: CodexUsageWindow;
  credits?: CodexCredits;
  individualLimit?: CodexSpendLimit;
  rateLimitReachedType?: string;
}

export interface RelaunchPayload {
  appExecutable: string;
  windowsCliPath?: string;
  codexHome: string;
  parentPids: number[];
  launchArguments: string[];
  waitTimeoutMs: number;
}
