import { Body, Controller, HttpCode, HttpStatus, Ip, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards';
import { CurrentUser } from '../../common/decorators';
import { AuthService } from './auth.service';
import { JwtUser } from './auth.types';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SetPasswordDto } from './dto/set-password.dto';
import { SocialLoginDto } from './dto/social-login.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() dto: RegisterDto, @Ip() ip: string) {
    return this.authService.register(dto, ip);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Ip() ip: string) {
    return this.authService.login(dto, ip);
  }

  /** Puerta separada del panel — los ADMIN solo entran por aquí, nunca por
   * /auth/login (ver AuthService.login/adminLogin). */
  @Post('admin-login')
  @HttpCode(HttpStatus.OK)
  async adminLogin(@Body() dto: LoginDto, @Ip() ip: string) {
    return this.authService.adminLogin(dto, ip);
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Ip() ip: string) {
    return this.authService.forgotPassword(dto, ip);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Post('social/google')
  @HttpCode(HttpStatus.OK)
  // ÚLTIMA IP (5a) — el `@Ip()` es NUEVO: era el único de los tres caminos de login que
  // no la recibía, y sin él quien entra sólo con Google no habría tenido IP nunca.
  async socialGoogle(@Body() dto: SocialLoginDto, @Ip() ip: string) {
    return this.authService.loginWithGoogle(dto, ip);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  async changePassword(@CurrentUser() user: JwtUser, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(user.userId, dto);
  }

  @Post('set-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  async setPassword(@CurrentUser() user: JwtUser, @Body() dto: SetPasswordDto) {
    return this.authService.setPassword(user.userId, dto);
  }
}
