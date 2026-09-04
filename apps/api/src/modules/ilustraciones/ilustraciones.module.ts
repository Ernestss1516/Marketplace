import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { R2Module } from '../../infra/r2/r2.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { RevalidateModule } from '../../common/revalidate/revalidate.module';
import { MediaCleanupModule } from '../media-cleanup/media-cleanup.module';
import { IlustracionesService } from './ilustraciones.service';
import { IlustracionesController } from './ilustraciones.controller';
import { AdminIlustracionesController } from './admin-ilustraciones.controller';

/**
 * E7 — molde literal de `BrandingModule`, y con las mismas cinco dependencias, porque es
 * exactamente el mismo problema: configuración del sitio con imagen subida. Un controller
 * público de lectura y otro de admin para escribir.
 */
@Module({
  imports: [PrismaModule, R2Module, AuditLogModule, RevalidateModule, MediaCleanupModule],
  controllers: [IlustracionesController, AdminIlustracionesController],
  providers: [IlustracionesService],
})
export class IlustracionesModule {}
