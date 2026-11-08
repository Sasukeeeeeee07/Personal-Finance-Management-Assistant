import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { buildAppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { loadConfig } from '../src/config/env';
import { MailerService } from '../src/auth/mailer.service';
import { DATABASE } from '../src/database/database.module';
import type { DB } from '../src/database/schema';

process.env.NODE_ENV = 'test';

export interface TestApp {
  app: INestApplication;
  http: () => ReturnType<typeof request>;
  mailer: MailerService;
  db: DB;
  close: () => Promise<void>;
}

/** Boots the real app on an in-memory PGlite database. */
export async function createTestApp(): Promise<TestApp> {
  const config = loadConfig({ NODE_ENV: 'test', JWT_ACCESS_SECRET: 'test-secret-test-secret-test-secret-123' });
  const moduleRef = await Test.createTestingModule({ imports: [buildAppModule(config)] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app, config);
  await app.init();
  return {
    app,
    http: () => request(app.getHttpServer()),
    mailer: app.get(MailerService),
    db: app.get(DATABASE),
    close: () => app.close(),
  };
}

let counter = 0;
export async function registerUser(t: TestApp, name = 'Test User') {
  counter += 1;
  const email = `user${counter}-${Date.now()}@example.com`;
  const password = 'sturdy-password-1';
  const res = await t.http().post('/api/v1/auth/register').send({ email, password, fullName: name }).expect(201);
  const token: string = res.body.accessToken;
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  return {
    email,
    password,
    token,
    refreshToken: res.body.refreshToken as string,
    get: (url: string) => auth(t.http().get(`/api/v1${url}`)),
    post: (url: string, body?: object) => auth(t.http().post(`/api/v1${url}`)).send(body ?? {}),
    patch: (url: string, body?: object) => auth(t.http().patch(`/api/v1${url}`)).send(body ?? {}),
    del: (url: string) => auth(t.http().delete(`/api/v1${url}`)),
  };
}

export type TestUser = Awaited<ReturnType<typeof registerUser>>;

export async function category(u: TestUser, name: string): Promise<string> {
  const res = await u.get('/categories').expect(200);
  const c = res.body.find((x: any) => x.name === name);
  if (!c) throw new Error(`category ${name} not found`);
  return c.id;
}

export const now = () => new Date().toISOString();
