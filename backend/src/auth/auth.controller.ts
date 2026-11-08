import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthUser, CurrentUser, Public } from '../common/auth-context';
import { AuthService, ClientInfo } from './auth.service';
import { AuthTokensResponse, EmailDto, GoogleLoginDto, LoginDto, LogoutDto, RefreshDto, RegisterDto, ResetPasswordDto, TokenDto } from './dto/auth.dto';

const clientInfo = (req: Request): ClientInfo => ({ userAgent: req.headers['user-agent'], ip: req.ip });

// Stricter limits on credential endpoints.
const AUTH_THROTTLE = { default: { limit: process.env.NODE_ENV === 'test' ? 10_000 : 10, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public() @Throttle(AUTH_THROTTLE) @Post('register')
  @ApiOkResponse({ type: AuthTokensResponse })
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.auth.register(dto, clientInfo(req));
  }

  @Public() @Throttle(AUTH_THROTTLE) @Post('login') @HttpCode(200)
  @ApiOkResponse({ type: AuthTokensResponse })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, clientInfo(req));
  }

  @Public() @Throttle(AUTH_THROTTLE) @Post('google') @HttpCode(200)
  @ApiOkResponse({ type: AuthTokensResponse })
  google(@Body() dto: GoogleLoginDto, @Req() req: Request) {
    return this.auth.loginWithGoogle(dto.idToken, clientInfo(req));
  }

  @Public() @Post('refresh') @HttpCode(200)
  @ApiOkResponse({ type: AuthTokensResponse })
  refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.auth.refresh(dto.refreshToken, clientInfo(req));
  }

  @Public() @Throttle(AUTH_THROTTLE) @Post('forgot-password') @HttpCode(202)
  async forgotPassword(@Body() dto: EmailDto) {
    await this.auth.forgotPassword(dto.email);
    return { message: 'If an account exists for that email, we sent a reset link.' };
  }

  @Public() @Throttle(AUTH_THROTTLE) @Post('reset-password') @HttpCode(204)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.password);
  }

  @Public() @Post('verify-email') @HttpCode(204)
  verifyEmail(@Body() dto: TokenDto) {
    return this.auth.verifyEmail(dto.token);
  }

  @ApiBearerAuth() @Throttle(AUTH_THROTTLE) @Post('resend-verification') @HttpCode(204)
  resendVerification(@CurrentUser() user: AuthUser) {
    return this.auth.resendVerification(user.userId);
  }

  @ApiBearerAuth() @Post('logout') @HttpCode(204)
  logout(@CurrentUser() user: AuthUser, @Body() dto: LogoutDto) {
    return this.auth.logout(user.userId, user.sessionId, dto.allDevices);
  }

  @ApiBearerAuth() @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.userId, user.organizationId, user.permissions);
  }

  @ApiBearerAuth() @Get('sessions')
  sessions(@CurrentUser() user: AuthUser) {
    return this.auth.listSessions(user.userId);
  }

  @ApiBearerAuth() @Delete('sessions/:id') @HttpCode(204)
  revokeSession(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.auth.revokeSession(user.userId, id);
  }
}
