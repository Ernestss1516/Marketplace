import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards';
import { CurrentUser } from '../../common/decorators';
import { JwtUser } from '../auth/auth.types';
import { UsersService } from './users.service';
import { UpdateMeDto } from './dto/update-me.dto';
import { ListingsService } from '../listings/listings.service';
import { MyListingsQueryDto } from '../listings/dto/my-listings-query.dto';

@ApiTags('Users')
@ApiBearerAuth('access-token')
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly listingsService: ListingsService,
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

  @Get(':slug')
  getPublicProfile(@Param('slug') slug: string) {
    return this.usersService.findBySlug(slug);
  }
}
