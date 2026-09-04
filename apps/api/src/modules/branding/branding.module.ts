import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { R2Module } from '../../infra/r2/r2.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { RevalidateModule } from '../../common/revalidate/revalidate.module';
import { MediaCleanupModule } from '../media-cleanup/media-cleanup.module';
import { BrandingService } from './branding.service';
import { BrandingController } from './branding.controller';
import { AdminBrandingController } from './admin-branding.controller';

/**
 * TRES LOGOS L1 — molde literal de `HomepageModule`, y con las mismas cinco
 * dependencias: la marca es configuración del sitio con imagen subida, exactamente como
 * la portada. Un controller público de lectura y otro de admin para escribir.
 */
@Module({
  imports: [PrismaModule, R2Module, AuditLogModule, RevalidateModule, MediaCleanupModule],
  controllers: [BrandingController, AdminBrandingController],
  providers: [BrandingService],
  // E8 — lo consume el `NotificationProcessor`: el logo público es la cabecera del
  // correo. Se exporta el servicio y no se duplica la lectura de las tres claves.
  exports: [BrandingService],
})
export class BrandingModule {}
