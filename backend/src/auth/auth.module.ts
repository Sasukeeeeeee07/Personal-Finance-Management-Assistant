import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { APP_CONFIG, AppConfig } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { RbacService } from '../rbac/rbac.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { MailerService } from './mailer.service';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({ secret: config.jwtAccessSecret, signOptions: { algorithm: 'HS256' }, verifyOptions: { algorithms: ['HS256'] } }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, MailerService, RbacService, AuditService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [RbacService, AuditService, MailerService],
})
export class AuthModule {}
