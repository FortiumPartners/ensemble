export interface AppConfig {
  logLevel: string;
  model: string | undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    logLevel: env.LOG_LEVEL ?? 'info',
    model: env.BOT_MODEL,
  };
}
