import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';

import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { GoogleLoginDto } from './dto/google-login.dto';
import { LoginEmailDto } from './dto/login-email.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterEmailDto } from './dto/register-email.dto';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';

@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register/email')
  async registerEmail(@Body() dto: RegisterEmailDto, @Req() req: Request) {
    const result = await this.auth.registerEmail({
      ...dto,
      context: { userAgent: req.headers['user-agent'], ipAddress: req.ip },
    });
    return this.shape(result);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('login/email')
  async loginEmail(@Body() dto: LoginEmailDto, @Req() req: Request) {
    const result = await this.auth.loginEmail({
      ...dto,
      context: { userAgent: req.headers['user-agent'], ipAddress: req.ip },
    });
    return this.shape(result);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('otp/send')
  async sendOtp(@Body() dto: SendOtpDto) {
    const r = await this.auth.sendPhoneOtp(dto.phone);
    return { sent: true, cooldownSeconds: r.cooldownSeconds };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('login/google')
  async loginGoogle(@Body() dto: GoogleLoginDto, @Req() req: Request) {
    const result = await this.auth.loginWithGoogle({
      idToken: dto.idToken,
      context: { userAgent: req.headers['user-agent'], ipAddress: req.ip },
    });
    return { ...this.shape(result), isNewUser: result.isNewUser };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('otp/verify')
  async verifyOtp(@Body() dto: VerifyOtpDto, @Req() req: Request) {
    const result = await this.auth.verifyPhoneOtp({
      phone: dto.phone,
      otp: dto.otp,
      username: dto.username,
      context: { userAgent: req.headers['user-agent'], ipAddress: req.ip },
    });
    return { ...this.shape(result), isNewUser: result.isNewUser };
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    const tokens = await this.auth.refresh(dto.refreshToken, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
    return { tokens };
  }

  @HttpCode(HttpStatus.OK)
  @Post('logout')
  async logout(@Body() dto: RefreshTokenDto) {
    await this.auth.logout(dto.refreshToken);
    return { success: true };
  }

  @Get('me')
  async me(@CurrentUser() current: AuthenticatedUser) {
    const user = await this.users.getByIdOrThrow(current.userId);
    return { user };
  }

  private shape(result: { user: unknown; tokens: unknown }) {
    return { user: result.user, tokens: result.tokens };
  }
}
