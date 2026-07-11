// SISTEMA DE BLOQUES — Ráfaga 1 (modelo + validación, SIN editor). Cubre la
// matriz de validación pedida: los 9 tipos válidos pasan; cada variante
// inválida se rechaza (faq sin items, tabla con filas de longitud distinta a
// headers, cta con href javascript:, image con URL externa, video con
// videoId basura, type desconocido, props extra); y que nada de esto llega a
// escribirse en BD cuando se rechaza (ni en creación ni en edición).

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

const OWN_IMAGE_URL = `${process.env.S3_PUBLIC_URL}/media/test-image.jpg`;

describe('Sistema de bloques — validación (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminToken: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    await prisma.user.create({
      data: {
        email: 'blocks-admin@example.com',
        name: 'Blocks Admin',
        slug: 'blocks-admin',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
        role: 'ADMIN',
      },
    });

    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'blocks-admin@example.com', password: 'Test1234!' });
    adminToken = res.body.accessToken as string;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  function createPost(title: string, blocks: unknown[]) {
    return request(app.getHttpServer())
      .post('/api/admin/blog')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title, blocks });
  }

  // ── Los 9 tipos válidos ──────────────────────────────────────────────────

  it('text válido → 201', async () => {
    const res = await createPost('Bloque text', [
      { id: 'b1', type: 'text', markdown: '# Hola\n\nContenido.' },
    ]).expect(201);
    expect(res.body.blocks).toEqual([{ id: 'b1', type: 'text', markdown: '# Hola\n\nContenido.' }]);
  });

  it('faq válido → 201', async () => {
    const res = await createPost('Bloque faq', [
      {
        id: 'b1',
        type: 'faq',
        title: 'FAQ',
        items: [{ question: '¿Qué?', answer: 'Esto.' }],
      },
    ]).expect(201);
    expect(res.body.blocks[0].items).toHaveLength(1);
  });

  it('hub válido → 201', async () => {
    const res = await createPost('Bloque hub', [
      {
        id: 'b1',
        type: 'hub',
        links: [{ label: 'Buscar', href: '/busqueda', description: 'desc' }],
      },
    ]).expect(201);
    expect(res.body.blocks[0].links[0].href).toBe('/busqueda');
  });

  it('image válido (URL de nuestro storage) → 201', async () => {
    const res = await createPost('Bloque image', [
      { id: 'b1', type: 'image', url: OWN_IMAGE_URL, alt: 'texto alternativo' },
    ]).expect(201);
    expect(res.body.blocks[0].url).toBe(OWN_IMAGE_URL);
  });

  it('cta válido (href relativo) → 201', async () => {
    const res = await createPost('Bloque cta', [
      { id: 'b1', type: 'cta', label: 'Publicar', href: '/publicar', style: 'primary' },
    ]).expect(201);
    expect(res.body.blocks[0].href).toBe('/publicar');
  });

  it('cta válido (href externo http/https) → 201', async () => {
    await createPost('Bloque cta externo', [
      { id: 'b1', type: 'cta', label: 'Externo', href: 'https://example.com' },
    ]).expect(201);
  });

  it('quote válido → 201', async () => {
    const res = await createPost('Bloque quote', [
      { id: 'b1', type: 'quote', text: 'Una cita', author: 'Alguien' },
    ]).expect(201);
    expect(res.body.blocks[0].text).toBe('Una cita');
  });

  it('video válido (youtube) → 201', async () => {
    const res = await createPost('Bloque video youtube', [
      { id: 'b1', type: 'video', provider: 'youtube', videoId: 'dQw4w9WgXcQ' },
    ]).expect(201);
    expect(res.body.blocks[0].videoId).toBe('dQw4w9WgXcQ');
  });

  it('video válido (vimeo) → 201', async () => {
    await createPost('Bloque video vimeo', [
      { id: 'b1', type: 'video', provider: 'vimeo', videoId: '123456789' },
    ]).expect(201);
  });

  it('separator válido → 201', async () => {
    const res = await createPost('Bloque separator', [{ id: 'b1', type: 'separator' }]).expect(201);
    expect(res.body.blocks).toEqual([{ id: 'b1', type: 'separator' }]);
  });

  it('table válida (filas con el mismo nº de columnas que headers) → 201', async () => {
    const res = await createPost('Bloque table', [
      {
        id: 'b1',
        type: 'table',
        headers: ['A', 'B'],
        rows: [
          ['1', '2'],
          ['3', '4'],
        ],
      },
    ]).expect(201);
    expect(res.body.blocks[0].rows).toHaveLength(2);
  });

  it('post con los 9 tipos a la vez → 201 (el esquema completo es válido combinado)', async () => {
    const res = await createPost('Post con los 9 bloques', [
      { id: 'b1', type: 'text', markdown: 'texto' },
      { id: 'b2', type: 'faq', items: [{ question: 'q', answer: 'a' }] },
      { id: 'b3', type: 'hub', links: [{ label: 'l', href: '/x' }] },
      { id: 'b4', type: 'image', url: OWN_IMAGE_URL, alt: 'alt' },
      { id: 'b5', type: 'cta', label: 'l', href: '/x' },
      { id: 'b6', type: 'quote', text: 'q' },
      { id: 'b7', type: 'video', provider: 'youtube', videoId: 'dQw4w9WgXcQ' },
      { id: 'b8', type: 'separator' },
      { id: 'b9', type: 'table', headers: ['H'], rows: [['1']] },
    ]).expect(201);
    expect(res.body.blocks).toHaveLength(9);
  });

  // ── Inválidos ────────────────────────────────────────────────────────────

  it('faq sin items → 400', async () => {
    await createPost('FAQ inválido', [{ id: 'b1', type: 'faq', items: [] }]).expect(400);
  });

  it('table con una fila de longitud ≠ headers.length → 400 (regla cruzada en el servicio)', async () => {
    await createPost('Tabla inválida', [
      {
        id: 'b1',
        type: 'table',
        headers: ['A', 'B'],
        rows: [['1', '2'], ['solo-una']],
      },
    ]).expect(400);
  });

  it('cta con href javascript: → 400', async () => {
    await createPost('CTA inválido', [
      { id: 'b1', type: 'cta', label: 'Malicioso', href: 'javascript:alert(1)' },
    ]).expect(400);
  });

  it('cta con href data: → 400', async () => {
    await createPost('CTA data URI', [
      { id: 'b1', type: 'cta', label: 'Malicioso', href: 'data:text/html,<script>alert(1)</script>' },
    ]).expect(400);
  });

  it('hub con un link href javascript: → 400', async () => {
    await createPost('Hub inválido', [
      { id: 'b1', type: 'hub', links: [{ label: 'Malicioso', href: 'javascript:alert(1)' }] },
    ]).expect(400);
  });

  it('image con URL externa (no nuestro storage) → 400', async () => {
    await createPost('Imagen externa', [
      { id: 'b1', type: 'image', url: 'https://evil.example.com/x.jpg', alt: 'x' },
    ]).expect(400);
  });

  it('video con videoId basura (youtube) → 400', async () => {
    await createPost('Video inválido', [
      { id: 'b1', type: 'video', provider: 'youtube', videoId: 'no-es-un-id-valido!!' },
    ]).expect(400);
  });

  it('video con provider desconocido → 400', async () => {
    await createPost('Video provider inválido', [
      { id: 'b1', type: 'video', provider: 'dailymotion', videoId: 'x' },
    ]).expect(400);
  });

  it('type de bloque desconocido → 400', async () => {
    await createPost('Tipo desconocido', [{ id: 'b1', type: 'carousel', foo: 'bar' }]).expect(400);
  });

  it('bloque con propiedad extra no declarada → 400 (whitelist/forbidNonWhitelisted)', async () => {
    await createPost('Props extra', [
      { id: 'b1', type: 'text', markdown: 'x', unexpectedProp: 'colado' },
    ]).expect(400);
  });

  it('image sin alt → 400 (obligatorio, no opcional)', async () => {
    await createPost('Imagen sin alt', [{ id: 'b1', type: 'image', url: OWN_IMAGE_URL }]).expect(400);
  });

  // ── Seguridad: nada inválido llega a escribirse en BD ────────────────────

  it('un POST rechazado por validación NO crea la fila en BD', async () => {
    const before = await prisma.post.count();
    await createPost('No debería crearse', [
      { id: 'b1', type: 'cta', label: 'x', href: 'javascript:alert(1)' },
    ]).expect(400);
    const after = await prisma.post.count();
    expect(after).toBe(before);
  });

  it('un PATCH rechazado por validación NO muta el post existente', async () => {
    const created = await createPost('Post a proteger', [
      { id: 'b1', type: 'text', markdown: 'original' },
    ]).expect(201);
    const id = created.body.id as string;

    await request(app.getHttpServer())
      .patch(`/api/admin/blog/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ blocks: [{ id: 'b1', type: 'cta', label: 'x', href: 'javascript:alert(1)' }] })
      .expect(400);

    const unchanged = await prisma.post.findUniqueOrThrow({ where: { id } });
    expect(unchanged.blocks).toEqual([{ id: 'b1', type: 'text', markdown: 'original' }]);
  });
});
