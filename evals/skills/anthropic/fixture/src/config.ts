export interface AppConfig {
  logLevel: string;
  policyPath: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    logLevel: env.LOG_LEVEL ?? 'info',
    policyPath: env.POLICY_PATH ?? 'docs/refund-policy.md',
  };
}
