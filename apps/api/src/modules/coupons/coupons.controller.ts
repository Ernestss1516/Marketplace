import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards';
import { CurrentUser } from '../../common/decorators';
import { JwtUser } from '../auth/auth.types';
import { CouponsService } from './coupons.service';
import { RedeemCouponDto } from './dto/redeem-coupon.dto';

/** H8 Bloque D fase 3a — canje de cupones. Cualquier usuario autenticado. */
@ApiTags('Coupons')
@ApiBearerAuth('access-token')
@Controller('coupons')
@UseGuards(JwtAuthGuard)
export class CouponsController {
  constructor(private readonly couponsService: CouponsService) {}

  @Post('redeem')
  @HttpCode(HttpStatus.OK)
  redeem(@Body() dto: RedeemCouponDto, @CurrentUser() user: JwtUser) {
    return this.couponsService.redeem(user.userId, dto);
  }
}
