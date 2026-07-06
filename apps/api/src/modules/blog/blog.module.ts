import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { BlogService } from './blog.service';
import { BlogController } from './blog.controller';
import { BlogAdminController } from './blog-admin.controller';
import { PagesController } from './pages.controller';

@Module({
  imports: [PrismaModule, AuditLogModule],
  controllers: [BlogController, BlogAdminController, PagesController],
  providers: [BlogService],
})
export class BlogModule {}
