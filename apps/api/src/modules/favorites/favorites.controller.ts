import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards';
import { CurrentUser } from '../../common/decorators';
import { JwtUser } from '../auth/auth.types';
import { FavoritesService } from './favorites.service';
import { FavoriteQueryDto } from './dto/favorite-query.dto';
import { BatchCheckDto } from './dto/batch-check.dto';

@ApiTags('Favorites')
@ApiBearerAuth('access-token')
@Controller('favorites')
@UseGuards(JwtAuthGuard)
export class FavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  // ── Batch check (must be declared before POST :listingId) ─────────────────

  @Post('batch-check')
  async batchCheck(@CurrentUser() user: JwtUser, @Body() dto: BatchCheckDto) {
    const favoritedIds = await this.favorites.batchCheck(user.userId, dto.listingIds);
    return { favoritedIds };
  }

  // ── Per-listing operations ────────────────────────────────────────────────

  @Post(':listingId')
  @HttpCode(HttpStatus.OK)
  add(@CurrentUser() user: JwtUser, @Param('listingId') listingId: string) {
    return this.favorites.add(user.userId, listingId);
  }

  @Delete(':listingId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: JwtUser, @Param('listingId') listingId: string) {
    return this.favorites.remove(user.userId, listingId);
  }

  // ── List ──────────────────────────────────────────────────────────────────

  @Get()
  list(@CurrentUser() user: JwtUser, @Query() query: FavoriteQueryDto) {
    return this.favorites.findByUser(user.userId, query.page ?? 1, query.perPage ?? 20);
  }

  @Get(':listingId')
  check(@CurrentUser() user: JwtUser, @Param('listingId') listingId: string) {
    return this.favorites.isFavorited(user.userId, listingId).then((favorited) => ({ favorited }));
  }
}
