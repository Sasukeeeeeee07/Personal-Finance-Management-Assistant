import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { buildOpenApiDocument } from '../src/app.setup';
import { createTestApp, TestApp } from './helpers';

/**
 * Contract freeze (review gate E). The generated OpenAPI document must equal the frozen copy in
 * docs/api/openapi-v1.json. Any API change fails this test until the snapshot is regenerated on
 * purpose with `npm run openapi:freeze` and the change is recorded in docs/API_CONTRACT.md.
 */
const FROZEN = join(__dirname, '..', '..', 'docs', 'api', 'openapi-v1.json');

describe('API contract', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => t.close());

  it('matches the frozen OpenAPI contract', () => {
    const current = JSON.stringify(buildOpenApiDocument(t.app), null, 2) + '\n';
    if (process.env.OPENAPI_FREEZE === '1') writeFileSync(FROZEN, current);
    expect(current).toBe(readFileSync(FROZEN, 'utf8'));
  });

  it('keeps every route under /api/v1', () => {
    const doc = buildOpenApiDocument(t.app);
    expect(Object.keys(doc.paths).every((p) => p.startsWith('/api/v1/'))).toBe(true);
  });
});
