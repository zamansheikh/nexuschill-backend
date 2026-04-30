import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { BannersAdminController } from './banners-admin.controller';
import { BannersController } from './banners.controller';
import { BannersService } from './banners.service';
import { HomeBanner, HomeBannerSchema } from './schemas/home-banner.schema';
import { SplashBanner, SplashBannerSchema } from './schemas/splash-banner.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: HomeBanner.name, schema: HomeBannerSchema },
      { name: SplashBanner.name, schema: SplashBannerSchema },
    ]),
  ],
  controllers: [BannersAdminController, BannersController],
  providers: [BannersService],
  exports: [BannersService],
})
export class BannersModule {}
