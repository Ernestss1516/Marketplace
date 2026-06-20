import { Controller, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards';

@Controller('reviews')
@UseGuards(JwtAuthGuard)
export class ReviewsController {}
