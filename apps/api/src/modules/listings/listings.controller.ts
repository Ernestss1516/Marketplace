import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards';
import { CurrentUser } from '../../common/decorators';
import { JwtUser } from '../auth/auth.types';
import { ListingsService } from './listings.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { RecentListingsQueryDto } from './dto/recent-listings-query.dto';

@ApiTags('Listings')
@ApiBearerAuth('access-token')
@Controller('listings')
export class ListingsController {
  constructor(private readonly listingsService: ListingsService) {}

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

  // Public — no auth required. Exact route registered before the parameterized
  // one so NestJS resolves GET /listings before GET /listings/:slug.
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

  @Get(':slug')
  findBySlug(@Param('slug') slug: string) {
    return this.listingsService.findBySlug(slug);
  }
}
