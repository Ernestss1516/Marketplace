import { Body, Controller, Get, HttpException, HttpStatus, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards';
import { CurrentUser } from '../../common/decorators';
import { JwtUser } from '../auth/auth.types';
import { UsersService } from './users.service';
import { UpdateMeDto } from './dto/update-me.dto';
import { UserSearchQueryDto } from './dto/user-search-query.dto';
import { USER_SEARCH_LIMIT_PER_HOUR, USER_SEARCH_WINDOW_SECONDS } from './user-search.constants';
import { RateLimitService } from '../../infra/redis/rate-limit.service';
import { ListingsService } from '../listings/listings.service';
import { MyListingsQueryDto } from '../listings/dto/my-listings-query.dto';
import { SellerListingsQueryDto } from '../listings/dto/seller-listings-query.dto';
import { ReviewsService } from '../reviews/reviews.service';
import { ReviewsQueryDto } from '../reviews/dto/reviews-query.dto';

@ApiTags('Users')
@ApiBearerAuth('access-token')
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly listingsService: ListingsService,
    private readonly reviewsService: ReviewsService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMe(@CurrentUser() user: JwtUser) {
    return this.usersService.findById(user.userId);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  updateMe(@CurrentUser() user: JwtUser, @Body() dto: UpdateMeDto) {
    return this.usersService.updateMe(user.userId, dto);
  }

  @Get('me/listings')
  @UseGuards(JwtAuthGuard)
  getMyListings(@CurrentUser() user: JwtUser, @Query() query: MyListingsQueryDto) {
    return this.listingsService.findMine(user.userId, query);
  }

  @Get(':slug/listings')
  getSellerListings(
    @Param('slug') slug: string,
    @Query() query: SellerListingsQueryDto,
  ) {
    return this.listingsService.findBySellerSlug(slug, query.page, query.perPage);
  }

  @Get(':slug/reviews')
  getUserReviews(@Param('slug') slug: string, @Query() query: ReviewsQueryDto) {
    return this.reviewsService.listForUser(slug, query.cursor, query.limit);
  }

  // Registrada antes de :slug para que Nest no la resuelva como un slug literal
  // "search" (mismo motivo que /listings vs /listings/:slug en ListingsController).
  // Ciclo de vida RÁFAGA 1 — buscador para elegir comprador/cliente al cerrar un
  // Deal cuando no está entre los contactos del anuncio.
  @Get('search')
  @UseGuards(JwtAuthGuard)
  async search(@CurrentUser() user: JwtUser, @Query() query: UserSearchQueryDto) {
    const limit = await this.rateLimit.checkAndIncrement(
      `users:search:user:${user.userId}`,
      USER_SEARCH_LIMIT_PER_HOUR,
      USER_SEARCH_WINDOW_SECONDS,
    );
    if (limit.limited) {
      throw new HttpException(
        { message: 'Demasiadas búsquedas, inténtalo más tarde', retryAfter: limit.retryAfter },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return this.usersService.search(query.q, user.userId);
  }

  @Get(':slug')
  getPublicProfile(@Param('slug') slug: string) {
    return this.usersService.findBySlug(slug);
  }
}
