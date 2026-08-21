import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, OptionalJwtAuthGuard } from '../../common/guards';
import { CurrentUser } from '../../common/decorators';
import { JwtUser } from '../auth/auth.types';
import { ListingsService } from './listings.service';
import { PhotoLimitsService } from '../listing-gate/photo-limits.service';
import { ListingOwnerActivityService } from './listing-owner-activity.service';
import { BillingService } from '../billing/billing.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { RecentListingsQueryDto } from './dto/recent-listings-query.dto';
import { CloseDealDto } from './dto/close-deal.dto';

@ApiTags('Listings')
@ApiBearerAuth('access-token')
@Controller('listings')
export class ListingsController {
  constructor(
    private readonly listingsService: ListingsService,
    private readonly billingService: BillingService,
    private readonly photoLimitsService: PhotoLimitsService,
    // ÚLTIMA IP (5a) — ver `gestion()` justo debajo.
    private readonly ownerActivity: ListingOwnerActivityService,
  ) {}

  /**
   * ÚLTIMA IP (5a) — ENVOLTORIO DE «EL DUEÑO HA GESTIONADO SU ANUNCIO».
   *
   * Ejecuta la acción y, **si sale bien**, anota quién y desde dónde. Si la acción lanza,
   * el `await` propaga y no se anota nada: no hubo gestión que registrar.
   *
   * VIVE EN EL CONTROLADOR, y ésa es la decisión de diseño entera. Aquí es donde el
   * `@Ip()` está disponible y —más importante— donde la frontera dueño/staff es
   * ESTRUCTURAL: las acciones de staff viven en `AdminController`, que no conoce este
   * servicio, y el cron del bump automático no pasa por ningún controlador. Las dos
   * exclusiones que el dato necesita no dependen de que nadie se acuerde de nada.
   *
   * Los `GET` de esta clase NO lo usan: ver el propio anuncio, sus estadísticas o sus
   * contactos no es gestionarlo, y contarlo convertiría este campo en un rastro de
   * navegación — justo lo que la decisión de privacidad dice que no es.
   */
  private async gestion<T>(listingId: string, ip: string, accion: Promise<T>): Promise<T> {
    const resultado = await accion;
    await this.ownerActivity.touch(listingId, ip);
    return resultado;
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentUser() user: JwtUser, @Body() dto: CreateListingDto, @Ip() ip: string) {
    // El id sale del resultado, así que éste no puede usar `gestion()`.
    const listing = await this.listingsService.create(user.userId, dto);
    await this.ownerActivity.touch(listing.id, ip);
    return listing;
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  update(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: UpdateListingDto,
    @Ip() ip: string,
  ) {
    return this.gestion(id, ip, this.listingsService.update(id, user.userId, dto));
  }

  @Post(':id/publish')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  publish(@Param('id') id: string, @CurrentUser() user: JwtUser, @Ip() ip: string) {
    return this.gestion(id, ip, this.listingsService.publish(id, user.userId));
  }

  @Post(':id/reserve')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  reserve(@Param('id') id: string, @CurrentUser() user: JwtUser, @Ip() ip: string) {
    return this.gestion(id, ip, this.listingsService.reserve(id, user.userId));
  }

  // ---------------------------------------------------------------------------
  // Ciclo de vida RÁFAGA 2 — pausar (temporal, reactivable) y archivar
  // (permanente, irreversible), alternativa no destructiva a remove().
  // ---------------------------------------------------------------------------

  @Post(':id/pause')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  pause(@Param('id') id: string, @CurrentUser() user: JwtUser, @Ip() ip: string) {
    return this.gestion(id, ip, this.listingsService.pause(id, user.userId));
  }

  @Post(':id/reactivate')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  reactivate(@Param('id') id: string, @CurrentUser() user: JwtUser, @Ip() ip: string) {
    return this.gestion(id, ip, this.listingsService.reactivate(id, user.userId));
  }

  @Post(':id/archive')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  archive(@Param('id') id: string, @CurrentUser() user: JwtUser, @Ip() ip: string) {
    return this.gestion(id, ip, this.listingsService.archive(id, user.userId));
  }

  // ---------------------------------------------------------------------------
  // Ciclo de vida RÁFAGA 1 — cerrar/deshacer tratos (ramificado por tipo en el
  // servicio). Sustituye a POST /:id/sold — una acción, un camino.
  // ---------------------------------------------------------------------------

  @Post(':id/deals')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  closeDeal(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: CloseDealDto,
    @Ip() ip: string,
  ) {
    return this.gestion(id, ip, this.listingsService.closeDeal(id, user.userId, dto));
  }

  @Get(':id/deals')
  @UseGuards(JwtAuthGuard)
  getDeals(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.listingsService.getDeals(id, user.userId);
  }

  @Delete(':id/deals/:dealId')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  undoDeal(
    @Param('id') id: string,
    @Param('dealId') dealId: string,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.gestion(id, ip, this.listingsService.undoDeal(id, dealId, user.userId));
  }

  // Contactos del anuncio — quick-pick del selector de comprador/cliente.
  @Get(':id/contacts')
  @UseGuards(JwtAuthGuard)
  getContacts(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.listingsService.getContacts(id, user.userId);
  }

  @Post(':id/renew')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  renew(@Param('id') id: string, @CurrentUser() user: JwtUser, @Ip() ip: string) {
    return this.gestion(id, ip, this.listingsService.renew(id, user.userId));
  }

  /**
   * BORRADO B2 — DESCARTAR UN BORRADOR, no «eliminar un anuncio».
   *
   * La ruta se mantiene (`DELETE /listings/:id`) porque sigue siendo un borrado
   * desde el punto de vista de HTTP, pero **lo que admite se ha estrechado a
   * `DRAFT`**: el dueño ya no puede destruir nada que haya llegado a existir para
   * otra persona. Eliminar un anuncio publicado es del staff y sólo sobre
   * archivados (`DELETE /admin/listings/:id`).
   *
   * Un intento sobre cualquier otro estado responde 400 con la salida escrita
   * —archivar—, no un 403 mudo: el vendedor tiene algo que hacer.
   */
  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  discardDraft(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.listingsService.discardDraft(id, user.userId);
  }

  // ---------------------------------------------------------------------------
  // RF.6: Bump (§4)
  // ---------------------------------------------------------------------------

  @Post(':id/bump')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  // ÚLTIMA IP (5a) — el bump MANUAL sí anota; el AUTOMÁTICO no puede, porque
  // `bump-auto.processor` llama a `BillingService.bump` directamente y no pasa por aquí.
  // Es la diferencia correcta: el dueño programó aquel bump hace semanas, no está
  // actuando ahora.
  bump(@Param('id') id: string, @CurrentUser() user: JwtUser, @Ip() ip: string) {
    return this.gestion(id, ip, this.billingService.bump(id, user.userId));
  }

  // "Ver teléfono" — requiere login. El teléfono NUNCA viaja en GET /:slug
  // (ver ListingsService.findBySlug); solo se sirve aquí, autenticado y con
  // rate limit.
  @Get(':id/phone')
  @UseGuards(JwtAuthGuard)
  getPhone(@Param('id') id: string, @CurrentUser() user: JwtUser, @Ip() ip: string) {
    return this.listingsService.getPhone(id, user.userId, ip);
  }

  // ---------------------------------------------------------------------------
  // Public — no auth required
  // ---------------------------------------------------------------------------

  // Exact route registered before the parameterized one so NestJS resolves
  // GET /listings before GET /listings/:slug.
  @Get()
  findRecent(@Query() query: RecentListingsQueryDto) {
    return this.listingsService.findRecent(query.page, query.perPage);
  }

  /**
   * PUERTA regla #3 — los topes de fotos vigentes. Molde exacto de
   * `GET /video/config`: el cliente los PREGUNTA en vez de llevar su propia copia
   * del número, así que interfaz y servidor no pueden discrepar. `minEnforced`
   * viaja con ellos para que el asistente sepa si el mínimo se está exigiendo de
   * verdad o sigue siendo sólo una recomendación.
   *
   * Va ANTES de `@Get(':slug')` a propósito: NestJS resuelve por orden de
   * declaración y si no, la ruta paramétrica se la tragaría.
   */
  @Get('photo-limits')
  photoLimits() {
    return this.photoLimitsService.getConfig();
  }

  // Authenticated owner-only access — registered before :slug to take priority.
  @Get('mine/:id')
  @UseGuards(JwtAuthGuard)
  getMine(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.listingsService.findMineById(id, user.userId);
  }

  // ---------------------------------------------------------------------------
  // H8 Bloque C1 — estadísticas (registradas antes de mine/:id/stats y de :slug)
  // ---------------------------------------------------------------------------

  @Get('mine/stats/summary')
  @UseGuards(JwtAuthGuard)
  getMineStatsSummary(@CurrentUser() user: JwtUser) {
    return this.listingsService.getMineStatsSummary(user.userId);
  }

  @Get('mine/:id/stats')
  @UseGuards(JwtAuthGuard)
  getMineStats(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.listingsService.getMineStats(id, user.userId);
  }

  // Público con auth opcional: cuenta anónimos, pero necesita saber si hay
  // sesión para excluir al dueño. El cliente lo llama al montar la ficha —
  // desacoplado del render cacheado en Redis (findBySlug).
  @Post(':slug/view')
  @UseGuards(OptionalJwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  trackView(
    @Param('slug') slug: string,
    @CurrentUser() user: JwtUser | null,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ) {
    const visitorHash = createHash('sha256').update(`${ip}:${userAgent ?? ''}`).digest('hex');
    return this.listingsService.trackView(slug, user?.userId ?? null, visitorHash);
  }

  @Get(':slug')
  findBySlug(@Param('slug') slug: string) {
    return this.listingsService.findBySlug(slug);
  }
}
