import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AgoraAdminController } from './agora-admin.controller';
import { AgoraController } from './agora.controller';
import { AgoraService } from './agora.service';
import {
  AgoraConfig,
  AgoraConfigSchema,
} from './schemas/agora-config.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AgoraConfig.name, schema: AgoraConfigSchema },
    ]),
  ],
  controllers: [AgoraAdminController, AgoraController],
  providers: [AgoraService],
  exports: [AgoraService],
})
export class AgoraModule {}
