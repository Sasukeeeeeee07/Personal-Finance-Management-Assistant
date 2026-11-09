export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
}

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
  /** Forecast weights for days 1–7, 8–30 and 31–90 before as-of (D-016). */
  forecastWeights: [number, number, number];
  /** Serve Swagger UI at /api/docs. Off in production unless ENABLE_API_DOCS=true. */
  apiDocs: boolean;
  /** Number of reverse proxies in front of the app (Render: 1), so rate limits see the real client IP. */
  trustProxy: number;
  smtp?: SmtpConfig;
}

function parseWeights(raw: string | undefined): [number, number, number] {
  const w = (raw ?? '0.5,0.3,0.2').split(',').map(Number);
  if (w.length !== 3 || w.some((x) => !Number.isFinite(x) || x < 0) || w.every((x) => x === 0)) {
    throw new Error('FORECAST_VARIABLE_WEIGHTS must be three non-negative numbers, e.g. 0.5,0.3,0.2');
  }
  return [w[0], w[1], w[2]];
}

const list = (raw: string | undefined) => (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);

/**
 * Reads configuration from the environment. In production every required value must be set
 * explicitly: there is no fallback to development defaults, and startup fails with a list of
 * everything that is missing or unsafe.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const prod = nodeEnv === 'production';
  const problems: string[] = [];

  const jwtAccessSecret = env.JWT_ACCESS_SECRET ?? '';
  const corsOrigins = list(env.CORS_ORIGINS);
  const port = Number(env.PORT ?? 4000);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) problems.push('PORT must be a valid port number');

  if (prod) {
    if (jwtAccessSecret.length < 32) problems.push('JWT_ACCESS_SECRET must be at least 32 characters');
    if (!env.DATABASE_URL) problems.push('DATABASE_URL is required (PGlite is development-only)');
    if (!corsOrigins.length) problems.push('CORS_ORIGINS is required (e.g. https://your-app.vercel.app)');
    if (corsOrigins.some((o) => o === '*' || !o.startsWith('https://'))) problems.push('CORS_ORIGINS must list explicit https:// origins, no wildcards');
    if (!env.APP_WEB_URL?.startsWith('https://')) problems.push('APP_WEB_URL must be the https:// address of the web app (used in email links)');
  }

  let smtp: SmtpConfig | undefined;
  if (env.SMTP_HOST) {
    if (!env.SMTP_FROM) problems.push('SMTP_FROM is required when SMTP_HOST is set');
    smtp = {
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT ?? 587),
      secure: env.SMTP_SECURE === 'true',
      user: env.SMTP_USER || undefined,
      password: env.SMTP_PASSWORD || undefined,
      from: env.SMTP_FROM ?? '',
    };
  }

  if (problems.length) throw new Error(`Invalid configuration:\n- ${problems.join('\n- ')}`);

  return {
    nodeEnv,
    port,
    databaseUrl: env.DATABASE_URL || undefined,
    pgliteDataDir: env.PGLITE_DATA_DIR || undefined,
    jwtAccessSecret: jwtAccessSecret || 'dev-only-insecure-secret-change-me-0123456789',
    jwtAccessTtlSeconds: Number(env.JWT_ACCESS_TTL_SECONDS ?? 900),
    refreshTokenTtlDays: Number(env.REFRESH_TOKEN_TTL_DAYS ?? 30),
    googleClientIds: list(env.GOOGLE_CLIENT_IDS),
    appWebUrl: env.APP_WEB_URL ?? 'http://localhost:3000',
    corsOrigins: corsOrigins.length ? corsOrigins : ['http://localhost:3000'],
    forecastWeights: parseWeights(env.FORECAST_VARIABLE_WEIGHTS),
    apiDocs: prod ? env.ENABLE_API_DOCS === 'true' : env.ENABLE_API_DOCS !== 'false',
    trustProxy: Number(env.TRUST_PROXY ?? (prod ? 1 : 0)),
    smtp,
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
