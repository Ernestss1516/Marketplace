import { Controller, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards';

@Controller('listings')
@UseGuards(JwtAuthGuard)
export class ListingsController {}
