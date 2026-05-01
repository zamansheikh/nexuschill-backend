import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { FcmController } from './fcm.controller';
import { FcmService } from './fcm.service';
import { DeviceToken, DeviceTokenSchema } from './schemas/device-token.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DeviceToken.name, schema: DeviceTokenSchema },
    ]),
  ],
  controllers: [FcmController],
  providers: [FcmService],
  exports: [FcmService],
})
export class FcmModule {}
