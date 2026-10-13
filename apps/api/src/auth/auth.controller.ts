import { Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { changePasswordSchema, loginSchema, type ChangePasswordInput, type LoginInput } from '@indotek/shared';
import { ApiZodBody, ZBody } from '../common/zod';
import { AuthService } from './auth.service';
import { clearAuthCookies, REFRESH_COOKIE, setAuthCookies } from './cookies';
import { AllowPendingPassword, CurrentUser, Public, SkipCsrf } from './decorators';
import { LoginRateLimiter } from './login-rate-limiter';
import type { AuthUser } from './auth.types';

/**
 * Token disimpan di cookie httpOnly (access: path /api, refresh: path /api/auth) + cookie csrf_token
 * yang dibaca web untuk header X-CSRF-Token. Body respons hanya berisi data user.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly limiter: LoginRateLimiter,
  ) {}

  @Public()
  @SkipCsrf()
  @Post('login')
  @HttpCode(200)
  @ApiZodBody(loginSchema)
  async login(@ZBody(loginSchema) body: LoginInput, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const ip = req.ip ?? 'unknown';
    this.limiter.hit(ip, body.email);
    const { tokens, user } = await this.auth.login(body.email, body.password);
    this.limiter.reset(ip, body.email);
    setAuthCookies(res, tokens);
    return { user };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      const { tokens, user } = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE]);
      setAuthCookies(res, tokens);
      return { user };
    } catch (e) {
      clearAuthCookies(res);
      throw e;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    clearAuthCookies(res);
  }

  @ApiCookieAuth()
  @AllowPendingPassword()
  @Post('change-password')
  @HttpCode(200)
  @ApiZodBody(changePasswordSchema)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @ZBody(changePasswordSchema) body: ChangePasswordInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { tokens, user: me } = await this.auth.changePassword(user.id, body.currentPassword, body.newPassword);
    setAuthCookies(res, tokens);
    return { user: me };
  }

  @ApiCookieAuth()
  @AllowPendingPassword()
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }
}
