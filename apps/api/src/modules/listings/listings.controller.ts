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
import { BillingService } from '../billing/billing.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { RecentListingsQueryDto } from './dto/recent-listings-query.dto';

@ApiTags('Listings')
@ApiBearerAuth('access-token')
@Controller('listings')
export class ListingsController {
  constructor(
    private readonly listingsService: ListingsService,
    private readonly billingService: BillingService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateListingDto) {
    return this.listingsService.create(user.userId, dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  update(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: UpdateListingDto,
  ) {
    return this.listingsService.update(id, user.userId, dto);
  }

  @Post(':id/publish')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  publish(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.listingsService.publish(id, user.userId);
  }

  @Post(':id/reserve')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  reserve(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.listingsService.reserve(id, user.userId);
  }

  @Post(':id/sold')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  sold(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.listingsService.markAsSold(id, user.userId);
  }

  @Post(':id/renew')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  renew(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.listingsService.renew(id, user.userId);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.listingsService.remove(id, user.userId);
  }

  // ---------------------------------------------------------------------------
  // RF.6: Bump (§4)
  // ---------------------------------------------------------------------------

  @Post(':id/bump')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  bump(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.billingService.bump(id, user.userId);
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
