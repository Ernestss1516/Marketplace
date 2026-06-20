import { Controller, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards';

@Controller('conversations')
@UseGuards(JwtAuthGuard)
export class MessagingController {}
