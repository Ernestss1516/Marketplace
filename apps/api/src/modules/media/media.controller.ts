import { Controller, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards';

@Controller('media')
@UseGuards(JwtAuthGuard)
export class MediaController {}
