import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { CosmeticsModule } from '../cosmetics/cosmetics.module';
import { WalletModule } from '../wallet/wallet.module';
import { DailyRewardAdminController } from './daily-reward-admin.controller';
import { DailyRewardController } from './daily-reward.controller';
import { DailyRewardService } from './daily-reward.service';
import {
  DailyRewardConfig,
  DailyRewardConfigSchema,
} from './schemas/daily-reward-config.schema';
import {
  UserDailyReward,
  UserDailyRewardSchema,
} from './schemas/user-daily-reward.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DailyRewardConfig.name, schema: DailyRewardConfigSchema },
      { name: UserDailyReward.name, schema: UserDailyRewardSchema },
    ]),
    CosmeticsModule,
    WalletModule,
  ],
  controllers: [DailyRewardAdminController, DailyRewardController],
  providers: [DailyRewardService],
  exports: [DailyRewardService],
})
export class DailyRewardModule {}
