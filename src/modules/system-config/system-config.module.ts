import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AdminAuthModule } from '../admin/admin-auth/admin-auth.module';
import { AppConfig, AppConfigSchema } from './schemas/app-config.schema';
import { SystemConfigController } from './system-config.controller';
import { SystemConfigService } from './system-config.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: AppConfig.name, schema: AppConfigSchema }]),
    AdminAuthModule,
  ],
  controllers: [SystemConfigController],
  providers: [SystemConfigService],
  exports: [SystemConfigService],
})
export class SystemConfigModule {}
