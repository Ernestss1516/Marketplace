import { Controller, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards';

@ApiTags('Messaging')
@ApiBearerAuth('access-token')
@Controller('conversations')
@UseGuards(JwtAuthGuard)
export class MessagingController {}
