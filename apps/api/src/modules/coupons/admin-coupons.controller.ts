import { Body, Controller, Get, Ip, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { CurrentUser, MinRole } from '../../common/decorators';
import { JwtUser } from '../auth/auth.types';
import { CouponsService } from './coupons.service';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';
import { ListCouponsDto } from './dto/list-coupons.dto';

/** H8 Bloque D fase 3b — gestión de cupones. ADMIN-only: es dinero regalado, como campañas. */
@ApiTags('Admin — Coupons')
@ApiBearerAuth('access-token')
@Controller('admin/coupons')
@UseGuards(JwtAuthGuard, RolesGuard)
@MinRole(Role.ADMIN)
export class AdminCouponsController {
  constructor(private readonly couponsService: CouponsService) {}

  @Get()
  list(@Query() query: ListCouponsDto) {
    return this.couponsService.list(query);
  }

  @Post()
  create(@Body() dto: CreateCouponDto, @CurrentUser() user: JwtUser, @Ip() ip: string) {
    return this.couponsService.create(dto, user.userId, ip);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCouponDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.couponsService.update(id, dto, user.userId, ip);
  }
}
