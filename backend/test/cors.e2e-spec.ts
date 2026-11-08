import { isAllowedOrigin } from '../src/app.setup';
import { loadConfig } from '../src/config/env';
import { createTestApp, TestApp } from './helpers';

describe('CORS', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => t.close());

  const preflight = (origin: string) =>
    t
      .http()
      .options('/api/v1/auth/register')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');

  it('allows the Flutter web dev server on a random localhost port (preflight)', async () => {
    const res = await preflight('http://localhost:55014');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:55014');
  });

  it('does not allow other sites', async () => {
    const res = await preflight('https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('production allows only the configured origins', () => {
    const prod = loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x', JWT_ACCESS_SECRET: 'x'.repeat(40), CORS_ORIGINS: 'https://app.example.com' });
    expect(isAllowedOrigin(prod, 'https://app.example.com')).toBe(true);
    expect(isAllowedOrigin(prod, 'http://localhost:55014')).toBe(false);
    expect(isAllowedOrigin(prod, 'https://evil.example')).toBe(false);
    expect(isAllowedOrigin(prod, undefined)).toBe(true); // no Origin header: native apps, curl
  });

  it('development accepts localhost and 127.0.0.1 on any port, but not look-alikes', () => {
    const dev = loadConfig({ NODE_ENV: 'development' });
    for (const ok of ['http://localhost:55014', 'http://127.0.0.1:8080', 'http://localhost', 'http://localhost:3000']) expect(isAllowedOrigin(dev, ok)).toBe(true);
    for (const bad of ['http://localhost.evil.example', 'https://localhost:55014x', 'http://192.168.1.5:55014', 'http://evil.example?localhost']) {
      expect(isAllowedOrigin(dev, bad)).toBe(false);
    }
  });
});
