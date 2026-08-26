import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ArchiveReason } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards';
import { CurrentUser } from '../../common/decorators';
import { JwtUser } from '../auth/auth.types';
import { AccountArchiveService } from '../account-archive/account-archive.service';
import { ArchiveAccountDto } from '../account-archive/dto/archive-account.dto';
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
    private readonly accountArchive: AccountArchiveService,
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

  /**
   * BORRADO DE CUENTAS C2 — el usuario archiva SU PROPIA cuenta.
   *
   * `SELF_REQUEST` y `actorId: null` van FIJOS aquí, no en el DTO: si la categoría
   * viajara en el cuerpo, cualquiera podría archivar diciendo que se lo pidieron.
   * El sujeto es siempre `user.userId` — este endpoint no acepta un id ajeno, así
   * que no hace falta comprobar propiedad.
   *
   * DESPUÉS DE ESTO EL TOKEN YA NO VALE: `archive()` incrementa `tokenVersion`, así
   * que la siguiente petición del cliente será un 401 y la de después un 403 del
   * gate. La respuesta se devuelve igualmente para que el frontend pueda cerrar
   * sesión ordenadamente en vez de descubrirlo con un error.
   */
  @Post('me/archive')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  archiveMyAccount(@CurrentUser() user: JwtUser, @Body() dto: ArchiveAccountDto) {
    return this.accountArchive.archive(user.userId, {
      reason: ArchiveReason.SELF_REQUEST,
      actorId: null,
      note: dto.note,
    });
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
