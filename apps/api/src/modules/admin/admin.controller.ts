import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ArchiveReason, Role } from '@prisma/client';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { CurrentUser, MinRole } from '../../common/decorators';
import { JwtUser } from '../auth/auth.types';
import { AdminService } from './admin.service';
import { ListAdminListingsDto } from './dto/list-admin-listings.dto';
import { SetListingTriageDto } from './dto/set-listing-triage.dto';
import { UpdateAdminListingDto } from './dto/update-admin-listing.dto';
import { ChangeListingStatusDto } from './dto/change-listing-status.dto';
import { ListAdminUsersDto } from './dto/list-admin-users.dto';
import { SuspendUserDto } from './dto/suspend-user.dto';
import { ChangeUserRoleDto } from './dto/change-user-role.dto';
import { SetUserTrustedDto } from './dto/set-user-trusted.dto';
import { SetUserRequiresReviewDto } from './dto/set-user-requires-review.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { ReorderCategoriesDto } from './dto/reorder-categories.dto';
import { AttributeUsageDto } from './dto/attribute-usage.dto';
import { UpdateSettingDto } from './dto/update-setting.dto';
import { AccountArchiveService } from '../account-archive/account-archive.service';
import { ArchiveAccountDto } from '../account-archive/dto/archive-account.dto';

@ApiTags('Admin')
@ApiBearerAuth('access-token')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@MinRole(Role.ADMIN)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    // BORRADO DE CUENTAS C2 — archivar/desarchivar viven en su propio servicio
    // porque los comparte con `UsersController` (el auto-archivado de `/perfil`).
    private readonly accountArchive: AccountArchiveService,
  ) {}

  // ─── Stats dashboard ──────────────────────────────────────────────────────

  // ROLES R2 — el dashboard es la sección de piso más bajo del backoffice
  // (EDITOR), así que su endpoint TIENE que bajar con ella: es el invariante
  // INV-1 («los endpoints que una sección necesita para cargar tienen piso ≤ el
  // de la sección»). Sin este override, un EDITOR entraría en /admin y la página
  // fallaría con 403 — el peor de los dos mundos, porque el nav le prometió una
  // sección que no puede usar.
  //
  // Lo que devuelve son AGREGADOS (contadores de anuncios, usuarios, reportes,
  // conversaciones y el estado del índice), no datos de ninguna persona.
  @Get('stats')
  @MinRole(Role.EDITOR)
  getStats() {
    return this.adminService.getStats();
  }

  // ─── Listings ─────────────────────────────────────────────────────────────

  @Get('listings')
  @MinRole(Role.MODERATOR)
  listListings(@Query() query: ListAdminListingsDto) {
    return this.adminService.listListings(query);
  }

  @Get('listings/:id')
  @MinRole(Role.MODERATOR)
  getListingById(@Param('id') id: string) {
    return this.adminService.getListingById(id);
  }

  /**
   * P3a — el staff edita los CAMPOS de un anuncio ajeno.
   *
   * MODERATOR, no ADMIN: editar es reversible —el texto anterior queda en
   * `AuditLog.before`— y es trabajo de moderación diario. La regla que fijó B2
   * reserva ADMIN para lo IRREVERSIBLE (eliminar) y para el dinero; esto no es ni
   * lo uno ni lo otro.
   *
   * Ruta hermana de `status` y `triage`, no la misma: los tres tocan ejes
   * distintos del anuncio y compartir endpoint invitaría a mezclarlos.
   */
  @Patch('listings/:id')
  @HttpCode(HttpStatus.OK)
  @MinRole(Role.MODERATOR)
  updateListing(
    @Param('id') id: string,
    @Body() dto: UpdateAdminListingDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.adminService.updateListing(id, user.userId, dto, ip);
  }

  /**
   * ETIQUETA INTERNA (P1) — la anotación del staff sobre un anuncio.
   *
   * MODERATOR+, como el resto de la sección: es trabajo de moderación diario y
   * TODO lo que hace es reversible —una etiqueta que se pone y se quita—, así que
   * no entra en la excepción de B2, que reserva ADMIN para lo irreversible.
   *
   * Ruta hermana de `status`, NO la misma: cambiar el estado y anotar el triaje
   * son cosas distintas sobre ejes distintos, y compartir endpoint invitaría a
   * mezclarlas.
   */
  @Patch('listings/:id/triage')
  @HttpCode(HttpStatus.OK)
  @MinRole(Role.MODERATOR)
  setListingTriage(
    @Param('id') id: string,
    @Body() dto: SetListingTriageDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.adminService.setListingTriage(id, user.userId, dto, ip);
  }

  @Patch('listings/:id/status')
  @HttpCode(HttpStatus.OK)
  @MinRole(Role.MODERATOR)
  changeListingStatus(
    @Param('id') id: string,
    @Body() dto: ChangeListingStatusDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.adminService.changeListingStatus(id, user.userId, dto, ip);
  }

  // BORRADO B2 — la única vía que destruye un anuncio.
  //
  // ADMIN-ONLY, y es una excepción deliberada dentro de una sección que es
  // MODERATOR: todas las demás acciones sobre un anuncio son REVERSIBLES —
  // aprobar, rechazar, desactivar, restaurar, cambiar de estado— y ésta no.
  // El moderador ya archiva, que es el trabajo del día a día; destruir es otra
  // decisión. Mismo criterio que el borrado físico de un post del blog, que es
  // ADMIN-only mientras el resto del blog está abierto a EDITOR.
  // Ver docs/diseno-borrado.md §6.1 (D-4).
  @Delete('listings/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @MinRole(Role.ADMIN)
  deleteListing(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.adminService.deleteListing(id, user.userId, ip);
  }

  // ─── Users ────────────────────────────────────────────────────────────────

  @Get('users')
  @MinRole(Role.MODERATOR)
  listUsers(@Query() query: ListAdminUsersDto) {
    return this.adminService.listUsers(query);
  }

  @Get('users/:id')
  @MinRole(Role.MODERATOR)
  getUserById(@Param('id') id: string) {
    return this.adminService.getUserById(id);
  }

  /**
   * BORRADO DE CUENTAS C4 — el cuerpo es NUEVO y es OPCIONAL.
   *
   * Sin él, la llamada se comporta exactamente como antes (el frontend actual la
   * hace sin cuerpo): la duración sale del ajuste `defaultSuspensionDays`, que
   * nace sin configurar y produce una suspensión indefinida. Con `days`, el
   * moderador fija el plazo — y entonces «suspender siete días» significa siete
   * días, sin que nadie tenga que acordarse de levantarla.
   */
  @Patch('users/:id/suspend')
  @HttpCode(HttpStatus.OK)
  @MinRole(Role.MODERATOR)
  suspendUser(
    @Param('id') id: string,
    @Body() dto: SuspendUserDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.adminService.suspendUser(id, user.userId, dto, ip);
  }

  // Reverses a SUSPENSION (SUSPENDED → ACTIVE). MODERATOR+ADMIN.
  // Does not apply to BANNED users — use reinstateUser (ADMIN-only) for that.
  @Patch('users/:id/unsuspend')
  @HttpCode(HttpStatus.OK)
  @MinRole(Role.MODERATOR)
  unsuspendUser(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.adminService.unsuspendUser(id, user.userId, ip);
  }

  // Permanent ban — ADMIN-only (inherits class-level @MinRole(ADMIN)).
  @Patch('users/:id/ban')
  @HttpCode(HttpStatus.OK)
  banUser(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.adminService.banUser(id, user.userId, ip);
  }

  // Reverses a BAN (BANNED → ACTIVE) — ADMIN-only (inherits class-level @MinRole(ADMIN)).
  @Patch('users/:id/reinstate')
  @HttpCode(HttpStatus.OK)
  reinstateUser(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.adminService.reinstateUser(id, user.userId, ip);
  }

  /**
   * BORRADO DE CUENTAS C2 — el staff archiva una cuenta.
   *
   * MODERATOR+, y el criterio es el mismo que el resto del backoffice usa:
   * **MODERATOR hace lo reversible, ADMIN lo irreversible**. Archivar es
   * reversible —`unarchive` la devuelve al estado que tenía— así que es trabajo de
   * moderación. Eliminar definitivamente (C5) será ADMIN.
   *
   * `STAFF_ACTION` va fijo: por esta puerta sólo se entra archivando a OTRO. Un
   * archivado a petición del usuario que el staff ejecuta por él —el caso de un
   * BANNED, que no puede pulsar nada— se distingue por `archiveReason`, y por eso
   * es una columna aparte de `archivedById`.
   */
  @Patch('users/:id/archive')
  @HttpCode(HttpStatus.OK)
  @MinRole(Role.MODERATOR)
  archiveUser(
    @Param('id') id: string,
    @Body() dto: ArchiveAccountDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.accountArchive.archive(id, {
      reason: ArchiveReason.STAFF_ACTION,
      actorId: user.userId,
      note: dto.note,
    });
  }

  /**
   * BORRADO DE CUENTAS C2 — el staff desarchiva. MODERATOR+ (reversible).
   *
   * NO ACEPTA ESTADO DE DESTINO, y no es una omisión: lo lee de
   * `statusBeforeArchive`. Si lo aceptara, archivar y desarchivar sería el camino
   * corto para que un MODERATOR levantara un ban que sólo un ADMIN puede levantar.
   */
  @Patch('users/:id/unarchive')
  @HttpCode(HttpStatus.OK)
  @MinRole(Role.MODERATOR)
  unarchiveUser(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.accountArchive.unarchive(id, user.userId, ip);
  }

  // Role change — ADMIN-only (inherits class-level @MinRole(ADMIN)). INNEGOCIABLE.
  @Patch('users/:id/role')
  @HttpCode(HttpStatus.OK)
  changeUserRole(
    @Param('id') id: string,
    @Body() dto: ChangeUserRoleDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.adminService.changeUserRole(id, user.userId, dto, ip);
  }

  // H8 Bloque E — "Vendedor de confianza": ADMIN-only (inherits class-level @MinRole(ADMIN)).
  // Otorgar confianza es decisión de plataforma, no moderación — a diferencia de
  // suspender, que MODERATOR también puede hacer.
  @Patch('users/:id/trusted')
  @HttpCode(HttpStatus.OK)
  setUserTrusted(
    @Param('id') id: string,
    @Body() dto: SetUserTrustedDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.adminService.setUserTrusted(id, user.userId, dto, ip);
  }

  // MODERACIÓN M4 — marcar a un VENDEDOR para revisión previa. ADMIN-only, mismo
  // criterio que la confianza: señalar a una persona tiene efectos sobre ella y se
  // audita nominalmente, así que no es trabajo de moderación del día a día.
  //
  // ENMENDADO EN ROLES R2 — ACOTACIÓN IMPORTANTE. Este argumento vale para ESTE
  // endpoint y NO para el nivel CATEGORÍA. M4 los separó como «específico vs.
  // genérico», y por ese eje los dos niveles específicos —usuario y categoría—
  // caían del mismo lado. El eje correcto es otro: **una persona vs. una rama del
  // catálogo**. Marcar una rama es configurar la propia cola de trabajo, que es
  // moderar; por eso `PATCH /admin/categories/:id` es MODERATOR desde R2 y esto
  // sigue siendo ADMIN.
  //
  // Quien venga a «arreglar» la asimetría igualando los dos, que lea antes
  // docs/diseno-roles.md §5: es deliberada.
  @Patch('users/:id/requires-review')
  @HttpCode(HttpStatus.OK)
  setUserRequiresReview(
    @Param('id') id: string,
    @Body() dto: SetUserRequiresReviewDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.adminService.setUserRequiresReview(id, user.userId, dto, ip);
  }

  // ─── Categories ───────────────────────────────────────────────────────────
  // IMPORTANT: static routes (@Get('categories/searchable-keys'),
  // @Patch('categories/reorder')) must be declared BEFORE param routes
  // (@Patch('categories/:id')) so the literal segment is not captured as :id.
  //
  // ROLES R2 — LOS SIETE MÉTODOS BAJAN A MODERATOR, y hace falta decirlo en los
  // siete: heredaban ADMIN de la clase, y esa herencia era silenciosa (nadie
  // había escrito «categorías es ADMIN», simplemente nadie escribió nada). El
  // catálogo es la materia prima del trabajo de moderar, así que va con la
  // sección `/admin/categorias`, que ahora es MODERATOR.
  //
  // CON ELLOS VIAJA `requiresReview` — ver la nota extensa en `updateCategory`.
  //
  // Deuda anotada: este controlador sirve CINCO secciones con TRES pisos
  // distintos (stats→EDITOR, listings/users/categories→MODERATOR,
  // settings→ADMIN). Partirlo en tres controladores es lo limpio y está
  // recomendado en docs/diseno-roles.md §4.4 (Decisión 3.1); mueve 22 rutas de
  // sitio, así que no entra en la misma ráfaga que reparte el inventario.

  @Get('categories/searchable-keys')
  @MinRole(Role.MODERATOR)
  async getSearchableAttributeKeys() {
    return this.adminService.getSearchableAttributeKeys();
  }

  @Get('categories')
  @MinRole(Role.MODERATOR)
  getCategories() {
    return this.adminService.getCategories();
  }

  @Post('categories')
  @HttpCode(HttpStatus.CREATED)
  @MinRole(Role.MODERATOR)
  createCategory(
    @Body() dto: CreateCategoryDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.adminService.createCategory(user.userId, dto, ip);
  }

  @Patch('categories/reorder')
  @HttpCode(HttpStatus.OK)
  @MinRole(Role.MODERATOR)
  reorderCategories(
    @Body() dto: ReorderCategoriesDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.adminService.reorderCategories(user.userId, dto, ip);
  }

  @Get('categories/:id/attribute-usage')
  @MinRole(Role.MODERATOR)
  getAttributeUsage(@Param('id') id: string, @Query() query: AttributeUsageDto) {
    return this.adminService.getAttributeUsage(id, query.key);
  }

  // ENMIENDA A M4 (ráfaga R2) — este endpoint es el que escribe
  // `Category.requiresReview`, el nivel CATEGORÍA del disparador de moderación
  // previa, y al bajar a MODERATOR cambia quién decide qué ramas se revisan.
  //
  // M4 argumentó que marcar para revisión es «política de plataforma, no una
  // acción de moderación del día a día», y por eso dejó ADMIN-only el nivel
  // USUARIO. Ese argumento SIGUE EN PIE para las personas y no se toca (ver
  // `setUserRequiresReview` más arriba). Lo que se corrige es el eje con el que
  // se separó: no es «específico vs. genérico» —la marca de categoría es tan
  // específica como la de usuario— sino **una rama del catálogo vs. una
  // persona**.
  //
  // Y por ese eje, la categoría es del moderador: configurar qué entra en la
  // propia cola de trabajo es moderar. Señalar a un vendedor concreto tiene
  // efectos sobre esa persona y se audita nominalmente, así que sigue arriba.
  // Reparto resultante: PLATAFORMA→ADMIN (/admin/ajustes), USUARIO→ADMIN,
  // CATEGORÍA→MODERATOR. Ver docs/diseno-roles.md §5.
  @Patch('categories/:id')
  @HttpCode(HttpStatus.OK)
  @MinRole(Role.MODERATOR)
  updateCategory(
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.adminService.updateCategory(id, user.userId, dto, ip);
  }

  @Delete('categories/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @MinRole(Role.MODERATOR)
  deleteCategory(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.adminService.deleteCategory(id, user.userId, ip);
  }

  // ─── Settings ─────────────────────────────────────────────────────────────
  //
  // ROLES R2 — SIGUEN EN ADMIN, y ahora es una decisión y no una herencia. Aquí
  // vive el interruptor de plataforma de la moderación previa
  // (`preModerationAllListings` y su exención por confianza): «reviso a todo el
  // mundo» es política, no trabajo de moderación.

  @Get('settings')
  getSettings() {
    return this.adminService.getSettings();
  }

  /**
   * PUNTO 6 · RÁFAGA B — CUÁNTO ESTÁ DISPARANDO CADA DETECTOR.
   *
   * Vive junto a los ajustes, y ADMIN por el piso de clase, porque es el dato que se mira
   * justo antes de tocar `detectionModes`: «si asciendo esto a bloquear, ¿a cuántos anuncios
   * afecta?».
   */
  @Get('detection/stats')
  getDetectionStats() {
    return this.adminService.getDetectionStats();
  }

  @Patch('settings/:key')
  @HttpCode(HttpStatus.OK)
  updateSetting(
    @Param('key') key: string,
    @Body() dto: UpdateSettingDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.adminService.updateSetting(key, user.userId, dto, ip);
  }
}
