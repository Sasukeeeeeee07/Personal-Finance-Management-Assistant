import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { buildAppModule } from './app.module';
import { configureApp } from './app.setup';
import { loadConfig } from './config/env';

async function bootstrap() {
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(buildAppModule(config));
  // Behind a reverse proxy (Render), trust its X-Forwarded-For so rate limits see the real client IP.
  if (config.trustProxy > 0) app.set('trust proxy', config.trustProxy);
  configureApp(app, config);
  app.enableShutdownHooks();
  // 0.0.0.0 so the container/platform router can reach the app; PORT is provided by Render.
  await app.listen(config.port, '0.0.0.0');
  console.log(`API listening on 0.0.0.0:${config.port} (${config.nodeEnv})${config.apiDocs ? ` — docs at /api/docs` : ''}`);
}

bootstrap().catch((err) => {
  // Configuration errors list every missing variable; never print secrets or stack traces of env values.
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
