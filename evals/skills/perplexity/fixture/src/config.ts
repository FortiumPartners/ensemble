export interface AppConfig {
  logLevel: string;
  summaryModel: string | undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    logLevel: env.LOG_LEVEL ?? 'info',
    summaryModel: env.SUMMARY_MODEL,
  };
}
