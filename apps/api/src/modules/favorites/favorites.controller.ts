import { Controller, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards';

@ApiTags('Favorites')
@ApiBearerAuth('access-token')
@Controller('favorites')
@UseGuards(JwtAuthGuard)
export class FavoritesController {}
