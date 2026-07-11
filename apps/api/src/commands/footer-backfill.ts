/**
 * Footer navigation backfill command.
 *
 * One-off migration for the footer-nav mini-hito: reads the legacy
 * Post.showInFooter/footerOrder/footerGroup fields (still present in the DB —
 * this MUST run before the follow-up migration that drops them) and creates
 * the equivalent FooterColumn/FooterItem rows.
 *
 * Grouping/ordering mirrors the old BlogService.listFooterPages() semantics
 * exactly: one FooterColumn per distinct footerGroup (footerGroup=null gets
 * its own column with name=null), column order = the MINIMUM footerOrder
 * among its pages, ties broken alphabetically by group name. Within a
 * column, items are ordered by the page's footerOrder. Each item's label is
 * seeded from the page's title (editable afterwards — labels are independent
 * of Post.title in the new model).
 *
 * Idempotency: skips entirely (logs and exits) if any FooterColumn already
 * exists, so re-running this script after the admin has started using
 * /admin/footer can't create duplicates.
 *
 * Usage (from apps/api/, BEFORE the "drop_post_footer_fields" migration):
 *   pnpm footer-backfill
 */

import { Module, Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

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
class FooterBackfillModule {}

type LegacyFooterPage = {
  id: string;
  title: string;
  footerOrder: number | null;
  footerGroup: string | null;
};

async function bootstrap(): Promise<void> {
  const logger = new Logger('FooterBackfill');

  const app = await NestFactory.createApplicationContext(FooterBackfillModule, {
    logger: ['error', 'warn', 'log'],
  });

  const prisma = app.get(PrismaService);

  const existingColumns = await prisma.footerColumn.count();
  if (existingColumns > 0) {
    logger.warn(
      `Ya existen ${existingColumns} FooterColumn — abortando para no duplicar (¿ya se corrió este script?).`,
    );
    await prisma.$disconnect();
    return;
  }

  // Lectura cruda vía $queryRaw: en cuanto la migración "drop_post_footer_fields"
  // se aplique, estas columnas desaparecen del modelo Prisma tipado — este
  // script solo tiene sentido ANTES de esa migración, y $queryRaw evita que el
  // build falle por columnas que el schema.prisma ya no declara en ese punto.
  const pages = await prisma.$queryRaw<LegacyFooterPage[]>`
    SELECT "id", "title", "footerOrder", "footerGroup"
    FROM "Post"
    WHERE "type" = 'PAGE' AND "status" = 'PUBLISHED' AND "showInFooter" = true
  `;

  logger.log(`${pages.length} página(s) marcadas showInFooter=true encontradas.`);

  if (pages.length === 0) {
    logger.log('Nada que migrar.');
    await prisma.$disconnect();
    return;
  }

  // Mismo agrupado/orden que BlogService.listFooterPages(): por footerGroup,
  // orden de columna = mínimo footerOrder del grupo, desempate alfabético.
  const byGroup = new Map<string | null, LegacyFooterPage[]>();
  for (const page of pages) {
    const key = page.footerGroup;
    const bucket = byGroup.get(key);
    if (bucket) bucket.push(page);
    else byGroup.set(key, [page]);
  }

  const groups = Array.from(byGroup.entries())
    .map(([group, groupPages]) => ({
      group,
      minOrder: Math.min(...groupPages.map((p) => p.footerOrder ?? 0)),
      pages: groupPages.sort((a, b) => (a.footerOrder ?? 0) - (b.footerOrder ?? 0)),
    }))
    .sort((a, b) => a.minOrder - b.minOrder || (a.group ?? '').localeCompare(b.group ?? ''));

  let columnsCreated = 0;
  let itemsCreated = 0;

  for (let columnOrder = 0; columnOrder < groups.length; columnOrder++) {
    const { group, pages: groupPages } = groups[columnOrder];

    const column = await prisma.footerColumn.create({
      data: { name: group, order: columnOrder },
    });
    columnsCreated++;

    for (let itemOrder = 0; itemOrder < groupPages.length; itemOrder++) {
      const page = groupPages[itemOrder];
      await prisma.footerItem.create({
        data: {
          columnId: column.id,
          label: page.title,
          order: itemOrder,
          type: 'PAGE',
          pageId: page.id,
        },
      });
      itemsCreated++;
    }

    logger.log(`Columna "${group ?? '(sin encabezado)'}" — ${groupPages.length} ítem(s).`);
  }

  logger.log(`Backfill completo. Columnas: ${columnsCreated}, ítems: ${itemsCreated}.`);

  // See reindex.ts for the explanation of why $disconnect() + no process.exit().
  await prisma.$disconnect();
}

bootstrap().catch(async (err: unknown) => {
  console.error('Footer backfill failed:', err);
  process.exit(1);
});
