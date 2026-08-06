import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { RevalidateModule } from '../../common/revalidate/revalidate.module';
import { NavService } from './nav.service';
import { NavController } from './nav.controller';
import { NavAdminController } from './nav-admin.controller';

// Calcado de FooterModule: mismas tres dependencias, un controller público y
// uno de admin, un service.
@Module({
  imports: [PrismaModule, AuditLogModule, RevalidateModule],
  controllers: [NavController, NavAdminController],
  providers: [NavService],
})
export class NavModule {}
