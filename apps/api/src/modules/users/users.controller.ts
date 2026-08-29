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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ArchiveReason } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards';
import { CurrentUser } from '../../common/decorators';
import { JwtUser } from '../auth/auth.types';
import { AccountArchiveService } from '../account-archive/account-archive.service';
import { ArchiveAccountDto } from '../account-archive/dto/archive-account.dto';
import { DataExportService } from '../data-export/data-export.service';
import { UsersService } from './users.service';
import { UpdateMeDto } from './dto/update-me.dto';
import {
  UnsubscribeDto,
  UpdateEmailPreferencesDto,
} from './dto/email-preferences.dto';
import { EmailPreferencesService } from './email-preferences.service';
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
    // BORRADO DE CUENTAS C6 — el mismo servicio que usa `AdminModule` para
    // exportar a un tercero. Vive en su propio módulo por eso.
    private readonly dataExport: DataExportService,
    // N5 — la válvula del correo: las categorías informativas y la baja.
    private readonly emailPreferences: EmailPreferencesService,
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

  // ─── NOTIFICACIONES N5 — preferencias de correo ────────────────────────────
  //
  // SÓLO GOBIERNAN LAS INFORMATIVAS. No hay aquí ninguna palanca para las
  // sanciones, el borrado de cuenta, el cambio de rol ni el dinero: esas no se
  // pueden apagar y su envío no consulta nada. Ver `email-categories.ts`.

  @Get('me/email-preferences')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Preferencias de correo (solo las categorías informativas)' })
  getEmailPreferences(@CurrentUser() user: JwtUser) {
    return this.emailPreferences.get(user.userId);
  }

  @Patch('me/email-preferences')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Activar o desactivar categorías informativas de correo' })
  updateEmailPreferences(
    @CurrentUser() user: JwtUser,
    @Body() dto: UpdateEmailPreferencesDto,
  ) {
    return this.emailPreferences.update(user.userId, dto);
  }

  /**
   * LA BAJA DESDE EL PIE DEL CORREO — **SIN SESIÓN**, a propósito.
   *
   * Quien se da de baja no va a iniciar sesión para hacerlo, y los proveedores de
   * correo esperan un enlace que funcione de un clic. La firma HMAC del enlace es
   * lo que sustituye a la sesión: sin el secreto del servidor no se puede forjar,
   * así que nadie puede dar de baja a otro.
   *
   * NO LLEVA `@UseGuards(JwtAuthGuard)`, y en este controlador eso es lo que
   * significa «público»: el guard se pone ruta a ruta, no a nivel de clase. La
   * ausencia es deliberada y por eso se explica aquí — es la única ruta sin sesión
   * del fichero.
   */
  @Post('unsubscribe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Baja de una categoría informativa desde el enlace del correo' })
  unsubscribe(@Body() dto: UnsubscribeDto) {
    return this.emailPreferences.bajaConFirma(dto.userId, dto.category, dto.signature);
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

  /**
   * BORRADO DE CUENTAS C6 — el usuario pide su exportación (§7.4).
   *
   * SIN `:id`, igual que `me/archive`: el sujeto es siempre `user.userId`, así que
   * no hay propiedad que comprobar porque no hay forma de nombrar a otro. La
   * exportación de un tercero entra por `POST /admin/users/:id/export`, que es
   * ADMIN.
   *
   * DEVUELVE 202-en-espíritu (200 con la fila `PENDING`): el ZIP no existe todavía
   * y no puede existir dentro de esta petición. El frontend pinta «preparando» y
   * el usuario recibe un aviso cuando esté.
   */
  @Post('me/export')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  requestMyExport(@CurrentUser() user: JwtUser) {
    return this.dataExport.requestForSelf(user.userId);
  }

  /** Las exportaciones propias, para pintar el estado y el enlace de descarga. */
  @Get('me/exports')
  @UseGuards(JwtAuthGuard)
  getMyExports(@CurrentUser() user: JwtUser) {
    return this.dataExport.listForSubject(user.userId);
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
