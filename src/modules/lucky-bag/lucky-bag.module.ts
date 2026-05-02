import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { RealtimeModule } from '../realtime/realtime.module';
import { WalletModule } from '../wallet/wallet.module';
import { LuckyBagController } from './lucky-bag.controller';
import { LuckyBagService } from './lucky-bag.service';
import { LuckyBag, LuckyBagSchema } from './schemas/lucky-bag.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: LuckyBag.name, schema: LuckyBagSchema },
    ]),
    WalletModule, // sender debit + recipient credit
    RealtimeModule, // ROOM_LUCKY_BAG_SENT / _CLAIMED broadcasts
  ],
  controllers: [LuckyBagController],
  providers: [LuckyBagService],
  exports: [LuckyBagService],
})
export class LuckyBagModule {}
