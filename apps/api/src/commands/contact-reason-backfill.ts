/**
 * Contact reason backfill command (RC.2).
 *
 * One-off migration: ContactMotivo (enum) → ContactReason (datos, gestionable
 * desde admin). Creates the 6 current reasons with human-readable names (not
 * the enum's SCREAMING_SNAKE_CASE) and maps every existing ContactMessage's
 * legacy `motivo` enum column to the new `motivoId` FK.
 *
 * MUST run after the "add_contact_reason" migration (adds ContactReason +
 * nullable motivoId, keeps the old `motivo` enum column) and BEFORE the
 * follow-up migration that drops `motivo`/ContactMotivo — same two-step
 * pattern as footer-backfill.ts.
 *
 * Idempotency: skips entirely if any ContactReason already exists, so
 * re-running after the admin has started managing reasons can't duplicate.
 *
 * Usage (from apps/api/, BEFORE the "drop_contact_motivo_enum" migration):
 *   pnpm contact-reason-backfill
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
class ContactReasonBackfillModule {}

// Orden = orden de aparición actual en el enum ContactMotivo — se conserva
// como orden inicial del <select> público; el admin puede reordenarlo después.
const REASONS: { enumValue: string; nombre: string }[] = [
  { enumValue: 'CONSULTA_GENERAL', nombre: 'Consulta general' },
  { enumValue: 'PROBLEMA_TECNICO', nombre: 'Problema técnico' },
  { enumValue: 'DENUNCIA_CONTENIDO', nombre: 'Denuncia de contenido' },
  { enumValue: 'FACTURACION', nombre: 'Facturación' },
  { enumValue: 'PRENSA', nombre: 'Prensa' },
  { enumValue: 'OTRO', nombre: 'Otro' },
];

async function bootstrap(): Promise<void> {
  const logger = new Logger('ContactReasonBackfill');

  const app = await NestFactory.createApplicationContext(ContactReasonBackfillModule, {
    logger: ['error', 'warn', 'log'],
  });

  const prisma = app.get(PrismaService);

  const existingReasons = await prisma.contactReason.count();
  if (existingReasons > 0) {
    logger.warn(
      `Ya existen ${existingReasons} ContactReason — abortando para no duplicar (¿ya se corrió este script?).`,
    );
    await prisma.$disconnect();
    return;
  }

  const idByEnumValue = new Map<string, string>();
  for (let orden = 0; orden < REASONS.length; orden++) {
    const { enumValue, nombre } = REASONS[orden];
    const created = await prisma.contactReason.create({ data: { nombre, orden } });
    idByEnumValue.set(enumValue, created.id);
    logger.log(`Creado ContactReason "${nombre}" (orden ${orden}) ← ${enumValue}`);
  }

  // $queryRaw: la columna legacy `motivo` sigue en el schema en este punto
  // (misma razón que footer-backfill.ts — solo tiene sentido leerla ANTES de
  // que la migración de retirada la elimine), pero usamos raw para no
  // depender de que el tipo enum siga vigente en el cliente generado.
  const messages = await prisma.$queryRaw<{ id: string; motivo: string | null }[]>`
    SELECT "id", "motivo"::text AS "motivo" FROM "ContactMessage" WHERE "motivoId" IS NULL
  `;

  logger.log(`${messages.length} mensaje(s) sin motivoId encontrados.`);

  let updated = 0;
  for (const message of messages) {
    if (!message.motivo) {
      logger.warn(`ContactMessage ${message.id} sin motivo legacy — se omite, requiere revisión manual.`);
      continue;
    }
    const motivoId = idByEnumValue.get(message.motivo);
    if (!motivoId) {
      logger.warn(`ContactMessage ${message.id}: motivo legacy "${message.motivo}" desconocido — se omite.`);
      continue;
    }
    await prisma.contactMessage.update({ where: { id: message.id }, data: { motivoId } });
    updated++;
  }

  logger.log(`Backfill completo. Motivos creados: ${REASONS.length}, mensajes migrados: ${updated}/${messages.length}.`);

  await prisma.$disconnect();
}

bootstrap().catch(async (err: unknown) => {
  console.error('Contact reason backfill failed:', err);
  process.exit(1);
});
