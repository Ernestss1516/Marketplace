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
  publish(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.listingsService.publish(id, user.userId);
  }

  @Post(':id/reserve')
  @UseGuards(JwtAuthGuard)
  reserve(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.listingsService.reserve(id, user.userId);
  }

  @Post(':id/sold')
  @UseGuards(JwtAuthGuard)
  sold(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.listingsService.markAsSold(id, user.userId);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.listingsService.remove(id, user.userId);
  }

  // Public — no auth guard. Must be declared after parameterized routes to
  // avoid conflicts, but since HTTP methods differ there is no ambiguity.
  @Get(':slug')
  findBySlug(@Param('slug') slug: string) {
    return this.listingsService.findBySlug(slug);
  }
}
