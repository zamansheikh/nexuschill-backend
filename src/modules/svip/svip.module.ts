import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { SvipAdminController } from './svip-admin.controller';
import { SvipController } from './svip.controller';
import { SvipService } from './svip.service';
import { SvipTier, SvipTierSchema } from './schemas/svip-tier.schema';
import {
  UserSvipStatus,
  UserSvipStatusSchema,
} from './schemas/user-svip-status.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SvipTier.name, schema: SvipTierSchema },
      { name: UserSvipStatus.name, schema: UserSvipStatusSchema },
    ]),
  ],
  controllers: [SvipAdminController, SvipController],
  providers: [SvipService],
  exports: [SvipService, MongooseModule],
})
export class SvipModule {}
