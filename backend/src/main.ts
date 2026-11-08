import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { buildAppModule } from './app.module';
import { configureApp } from './app.setup';
import { loadConfig } from './config/env';

async function bootstrap() {
  const config = loadConfig();
  const app = await NestFactory.create(buildAppModule(config));
  configureApp(app, config);
  app.enableShutdownHooks();
  await app.listen(config.port);
  console.log(`API on http://localhost:${config.port}/api/v1 — docs at http://localhost:${config.port}/api/docs`);
}

bootstrap();
