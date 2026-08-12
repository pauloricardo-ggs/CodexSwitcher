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

export interface RelaunchPayload {
  appExecutable: string;
  codexHome: string;
  parentPids: number[];
  launchArguments: string[];
  waitTimeoutMs: number;
}
