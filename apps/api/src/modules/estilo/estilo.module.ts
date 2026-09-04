import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { RevalidateModule } from '../../common/revalidate/revalidate.module';
import { EstiloService } from './estilo.service';
import { EstiloController } from './estilo.controller';
import { AdminEstiloController } from './admin-estilo.controller';

/**
 * E4a — molde de `BrandingModule` menos R2 y la limpieza de medios: aquí todavía no se
 * sube ningún fichero. Las ilustraciones (E7) traerán esas dos dependencias.
 */
@Module({
  imports: [PrismaModule, AuditLogModule, RevalidateModule],
  controllers: [EstiloController, AdminEstiloController],
  providers: [EstiloService],
  // E8 — lo consume el `NotificationProcessor` para resolver el tema del correo. Es la
  // MISMA resolución que pinta la web (`GET /estilo`), no una copia: lo único que cambia
  // es que el correo la convierte a hexadecimal inline, porque no hay variables CSS.
  exports: [EstiloService],
})
export class EstiloModule {}
