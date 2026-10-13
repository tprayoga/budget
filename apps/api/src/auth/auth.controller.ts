import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { loginSchema, refreshSchema, type LoginInput } from '@indotek/shared';
import { ApiZodBody, ZBody } from '../common/zod';
import { AuthService } from './auth.service';
import { CurrentUser, Public } from './decorators';
import type { AuthUser } from './auth.types';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiZodBody(loginSchema)
  login(@ZBody(loginSchema) body: LoginInput) {
    return this.auth.login(body.email, body.password);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiZodBody(refreshSchema)
  refresh(@ZBody(refreshSchema) body: { refreshToken: string }) {
    return this.auth.refresh(body.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@ZBody(refreshSchema) body: { refreshToken: string }) {
    await this.auth.logout(body.refreshToken);
  }

  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }
}
