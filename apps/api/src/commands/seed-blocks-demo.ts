/**
 * Blocks demo seed — QA visual del sistema de bloques (Ráfaga 1).
 *
 * Crea (o actualiza, si ya existen) un Post PAGE y un Post POST, ambos
 * PUBLISHED, con los 9 tipos de bloque rellenos de contenido de ejemplo.
 * Objetivo: verificar EN VIVO en /paginas/blocks-demo y /blog/blocks-demo-post
 * que los 9 se renderizan bien (desktop y móvil) ANTES de invertir en los 9
 * formularios del editor (Ráfaga 2) — "los renderizadores son la validación
 * barata del esquema".
 *
 * Escribe directo vía Prisma (sin pasar por CreatePostDto/BlogService) — el
 * objetivo es sembrar datos para inspección visual, no ejercitar la
 * validación (esa la cubren los tests de blocks.validation.spec.ts). El
 * bloque `image` reutiliza la URL de un ListingImage real ya subido a
 * R2/MinIO (si existe) para que también pase el chequeo `isOwnStorageUrl` en
 * caso de que luego se edite desde el admin.
 *
 * Usage (from apps/api/):
 *   pnpm seed-blocks-demo
 */

import { Module, Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { Prisma } from '@prisma/client';

import configuration from '../config/configuration';
import { envValidationSchema } from '../config/env.validation';
import { PrismaModule } from '../infra/prisma/prisma.module';
import { PrismaService } from '../infra/prisma/prisma.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
    }),
    PrismaModule,
  ],
})
class SeedBlocksDemoModule {}

function buildBlocks(imageUrl: string): Prisma.InputJsonValue {
  return [
    {
      id: 'demo-text',
      type: 'text',
      markdown:
        '# Bienvenido al sistema de bloques\n\nEste es un bloque de **texto** en Markdown — reutiliza la misma tubería ya auditada (`react-markdown` + `remark-gfm` + `rehype-sanitize`, sin `rehype-raw`).\n\n- Listas\n- *Cursiva* y **negrita**\n- [Enlaces](/busqueda) también funcionan',
    },
    {
      id: 'demo-faq',
      type: 'faq',
      title: 'Preguntas frecuentes',
      items: [
        { question: '¿Qué es un bloque?', answer: 'Una unidad de contenido con una forma fija según su `type` — texto, FAQ, imagen, etc.' },
        { question: '¿Se puede reordenar?', answer: 'Sí, el orden es la posición dentro del array `blocks` — no hay un campo `order` aparte.' },
        { question: '¿Y el editor?', answer: 'Llega en la Ráfaga 2 — esta ráfaga solo valida que el esquema y los renderizadores sean correctos.' },
      ],
    },
    {
      id: 'demo-hub',
      type: 'hub',
      title: 'Enlaces relacionados',
      links: [
        { label: 'Buscar anuncios', href: '/busqueda', description: 'Explora todo el catálogo' },
        { label: 'Publicar gratis', href: '/publicar', description: 'Sube tu anuncio en minutos' },
        { label: 'Sitio de Anthropic', href: 'https://www.anthropic.com', description: 'Enlace externo de ejemplo' },
      ],
    },
    {
      id: 'demo-image',
      type: 'image',
      url: imageUrl,
      alt: 'Imagen de ejemplo reutilizada de un anuncio existente',
      caption: 'Pie de foto de ejemplo',
      position: 'center',
      width: 80,
    },
    {
      id: 'demo-cta',
      type: 'cta',
      label: 'Publicar un anuncio',
      href: '/publicar',
      style: 'primary',
    },
    {
      id: 'demo-quote',
      type: 'quote',
      text: 'La mejor forma de vender de segunda mano, con mensajería sin compartir el teléfono.',
      author: 'Un vendedor satisfecho',
    },
    {
      id: 'demo-video',
      type: 'video',
      provider: 'youtube',
      videoId: 'dQw4w9WgXcQ',
    },
    {
      id: 'demo-separator',
      type: 'separator',
    },
    {
      id: 'demo-table',
      type: 'table',
      headers: ['Plan', 'Precio', 'Anuncios activos'],
      rows: [
        ['Free', '0€', '5'],
        ['Pro', '9,99€/mes', '20'],
      ],
    },
  ];
}

async function bootstrap(): Promise<void> {
  const logger = new Logger('SeedBlocksDemo');

  const app = await NestFactory.createApplicationContext(SeedBlocksDemoModule, {
    logger: ['error', 'warn', 'log'],
  });

  const prisma = app.get(PrismaService);

  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  if (!admin) {
    logger.error('No hay ningún usuario ADMIN en la BD — no se puede asignar authorId. Aborta.');
    await prisma.$disconnect();
    process.exit(1);
  }

  const listingImage = await prisma.listingImage.findFirst({ select: { url: true } });
  const imageUrl = listingImage?.url ?? '';
  if (!imageUrl) {
    logger.warn('No hay ningún ListingImage en la BD — el bloque `image` quedará con url vacía (fallará su validación si se reedita desde el admin).');
  }

  const blocks = buildBlocks(imageUrl);

  const page = await prisma.post.upsert({
    where: { slug: 'blocks-demo' },
    create: {
      type: 'PAGE',
      title: 'Demo de bloques',
      slug: 'blocks-demo',
      excerpt: 'Página de demostración con los 9 tipos de bloque, para QA visual.',
      blocks,
      status: 'PUBLISHED',
      publishedAt: new Date(),
      authorId: admin.id,
    },
    update: { blocks, status: 'PUBLISHED', publishedAt: new Date() },
  });
  logger.log(`PAGE sembrada: /paginas/${page.slug}`);

  const post = await prisma.post.upsert({
    where: { slug: 'blocks-demo-post' },
    create: {
      type: 'POST',
      title: 'Demo de bloques (post)',
      slug: 'blocks-demo-post',
      excerpt: 'Artículo de demostración con los 9 tipos de bloque, para QA visual.',
      blocks,
      status: 'PUBLISHED',
      publishedAt: new Date(),
      authorId: admin.id,
    },
    update: { blocks, status: 'PUBLISHED', publishedAt: new Date() },
  });
  logger.log(`POST sembrado: /blog/${post.slug}`);

  await prisma.$disconnect();
}

bootstrap().catch(async (err: unknown) => {
  console.error('Seed blocks demo failed:', err);
  process.exit(1);
});
