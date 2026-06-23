import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';

/**
 * Smoke test — verifies the RT.1 scaffolding works end-to-end:
 *   globalSetup ran (prisma migrate deploy + seed-test.ts)
 *   → NestJS app boots against the test database
 *   → a real HTTP request returns expected data from the seed
 *
 * This is intentionally minimal. Business-logic assertions live in RT.2–RT.5.
 */
describe('Smoke (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/categories returns 200 and includes the seeded categories', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/categories')
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);

    const slugs: string[] = res.body.map((c: { slug: string }) => c.slug);
    expect(slugs).toContain('electronica');

    const electronica = res.body.find((c: { slug: string }) => c.slug === 'electronica');
    expect(electronica).toBeDefined();
    expect(electronica.children).toEqual(
      expect.arrayContaining([expect.objectContaining({ slug: 'moviles' })]),
    );
  });
});
