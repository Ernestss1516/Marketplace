import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { BlogService } from './blog.service';
import { BlogController } from './blog.controller';
import { BlogAdminController } from './blog-admin.controller';

@Module({
  imports: [PrismaModule, AuditLogModule],
  controllers: [BlogController, BlogAdminController],
  providers: [BlogService],
})
export class BlogModule {}
