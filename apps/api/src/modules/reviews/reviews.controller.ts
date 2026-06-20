import { Controller, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards';

@ApiTags('Reviews')
@ApiBearerAuth('access-token')
@Controller('reviews')
@UseGuards(JwtAuthGuard)
export class ReviewsController {}
