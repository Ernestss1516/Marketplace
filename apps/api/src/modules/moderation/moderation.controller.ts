import { Controller, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { Roles } from '../../common/decorators';
import { Role } from '@prisma/client';

@Controller('moderation')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.MODERATOR, Role.ADMIN)
export class ModerationController {}
