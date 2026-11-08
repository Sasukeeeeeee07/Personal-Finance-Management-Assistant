export interface AppConfig {
  nodeEnv: string;
  port: number;
  databaseUrl?: string;
  pgliteDataDir?: string;
  jwtAccessSecret: string;
  jwtAccessTtlSeconds: number;
  refreshTokenTtlDays: number;
  googleClientIds: string[];
  appWebUrl: string;
  corsOrigins: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const jwtAccessSecret = env.JWT_ACCESS_SECRET ?? '';
  if (nodeEnv === 'production' && jwtAccessSecret.length < 32) {
    throw new Error('JWT_ACCESS_SECRET must be set to at least 32 characters in production');
  }
  if (nodeEnv === 'production' && !env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required in production');
  }
  return {
    nodeEnv,
    port: Number(env.PORT ?? 4000),
    databaseUrl: env.DATABASE_URL || undefined,
    pgliteDataDir: env.PGLITE_DATA_DIR || undefined,
    jwtAccessSecret: jwtAccessSecret || 'dev-only-insecure-secret-change-me-0123456789',
    jwtAccessTtlSeconds: Number(env.JWT_ACCESS_TTL_SECONDS ?? 900),
    refreshTokenTtlDays: Number(env.REFRESH_TOKEN_TTL_DAYS ?? 30),
    googleClientIds: (env.GOOGLE_CLIENT_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    appWebUrl: env.APP_WEB_URL ?? 'http://localhost:3000',
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:3000').split(',').map((s) => s.trim()).filter(Boolean),
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
