import { Controller, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { Roles } from '../../common/decorators';
import { Role } from '@prisma/client';

@ApiTags('Moderation')
@ApiBearerAuth('access-token')
@Controller('moderation')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.MODERATOR, Role.ADMIN)
export class ModerationController {}
