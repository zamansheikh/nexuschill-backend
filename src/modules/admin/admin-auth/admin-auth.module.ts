import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';

import { AdminUsersModule } from '../admin-users/admin-users.module';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminAuthGuard } from './guards/admin-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import {
  AdminRefreshToken,
  AdminRefreshTokenSchema,
} from './schemas/admin-refresh-token.schema';
import { AdminTokenService } from './services/admin-token.service';
import { AdminJwtStrategy } from './strategies/admin-jwt.strategy';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('adminJwt.accessSecret'),
        signOptions: { expiresIn: config.get<string>('adminJwt.accessExpires', '30m') },
      }),
    }),
    MongooseModule.forFeature([
      { name: AdminRefreshToken.name, schema: AdminRefreshTokenSchema },
    ]),
    AdminUsersModule,
  ],
  controllers: [AdminAuthController],
  providers: [
    AdminAuthService,
    AdminTokenService,
    AdminJwtStrategy,
    AdminAuthGuard,
    PermissionsGuard,
  ],
  exports: [AdminAuthService, AdminTokenService, AdminJwtStrategy, AdminAuthGuard, PermissionsGuard],
})
export class AdminAuthModule {}
