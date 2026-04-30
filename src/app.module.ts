import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

import { AppController } from './app.controller';
import { configuration } from './config/configuration';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { AdminModule } from './modules/admin/admin.module';
import { AgenciesModule } from './modules/agencies/agencies.module';
import { AgoraModule } from './modules/agora/agora.module';
import { AuthModule } from './modules/auth/auth.module';
import { BannersModule } from './modules/banners/banners.module';
import { CommonModule } from './modules/common/common.module';
import { CosmeticsModule } from './modules/cosmetics/cosmetics.module';
import { DailyRewardModule } from './modules/daily-reward/daily-reward.module';
import { GiftsModule } from './modules/gifts/gifts.module';
import { MediaModule } from './modules/media/media.module';
import { MomentsModule } from './modules/moments/moments.module';
import { ResellersModule } from './modules/resellers/resellers.module';
import { RoomsModule } from './modules/rooms/rooms.module';
import { StoreModule } from './modules/store/store.module';
import { SvipModule } from './modules/svip/svip.module';
import { UsersModule } from './modules/users/users.module';
import { WalletModule } from './modules/wallet/wallet.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      validate: validateEnv,
    }),

    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.get<string>('nodeEnv') === 'production' ? 'info' : 'debug',
          transport:
            config.get<string>('nodeEnv') === 'production'
              ? undefined
              : {
                  target: 'pino-pretty',
                  options: { singleLine: true, colorize: true, translateTime: 'HH:MM:ss' },
                },
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              '*.password',
              '*.refreshToken',
              '*.otp',
            ],
            remove: true,
          },
          customProps: (req) => ({ traceId: (req as any).traceId }),
        },
      }),
    }),

    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          name: 'default',
          ttl: config.get<number>('throttle.ttl', 60) * 1000,
          limit: config.get<number>('throttle.limit', 100),
        },
      ],
    }),

    DatabaseModule,
    RedisModule,
    MediaModule,
    CommonModule,

    UsersModule,
    AuthModule,
    AdminModule,
    AgenciesModule,
    WalletModule,
    GiftsModule,
    ResellersModule,
    CosmeticsModule,
    SvipModule,
    StoreModule,
    BannersModule,
    DailyRewardModule,
    AgoraModule,
    MomentsModule,
    RoomsModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
