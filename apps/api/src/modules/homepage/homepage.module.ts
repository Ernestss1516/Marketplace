import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { R2Module } from '../../infra/r2/r2.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { RevalidateModule } from '../../common/revalidate/revalidate.module';
import { HomepageService } from './homepage.service';
import { HomepageController } from './homepage.controller';
import { HomepageAdminController } from './homepage-admin.controller';

@Module({
  imports: [PrismaModule, R2Module, AuditLogModule, RevalidateModule],
  controllers: [HomepageController, HomepageAdminController],
  providers: [HomepageService],
})
export class HomepageModule {}
