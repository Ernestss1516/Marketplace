import { Controller, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards';

@Controller('favorites')
@UseGuards(JwtAuthGuard)
export class FavoritesController {}
