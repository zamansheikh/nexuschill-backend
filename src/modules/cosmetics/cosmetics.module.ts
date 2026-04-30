import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { CosmeticsAdminController } from './cosmetics-admin.controller';
import { CosmeticsController } from './cosmetics.controller';
import { CosmeticsService } from './cosmetics.service';
import { CosmeticItem, CosmeticItemSchema } from './schemas/cosmetic-item.schema';
import { UserCosmetic, UserCosmeticSchema } from './schemas/user-cosmetic.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CosmeticItem.name, schema: CosmeticItemSchema },
      { name: UserCosmetic.name, schema: UserCosmeticSchema },
    ]),
  ],
  controllers: [CosmeticsAdminController, CosmeticsController],
  providers: [CosmeticsService],
  exports: [CosmeticsService, MongooseModule],
})
export class CosmeticsModule {}
