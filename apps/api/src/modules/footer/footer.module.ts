import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { RevalidateModule } from '../../common/revalidate/revalidate.module';
import { FooterService } from './footer.service';
import { FooterController } from './footer.controller';
import { FooterAdminController } from './footer-admin.controller';

@Module({
  imports: [PrismaModule, AuditLogModule, RevalidateModule],
  controllers: [FooterController, FooterAdminController],
  providers: [FooterService],
})
export class FooterModule {}
