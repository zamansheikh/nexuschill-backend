import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { RocketModule } from '../rocket/rocket.module';
import { UsersModule } from '../users/users.module';
import { WalletModule } from '../wallet/wallet.module';
import { AdminGiftsController } from './admin-gifts.controller';
import { GiftEvent, GiftEventSchema } from './schemas/gift-event.schema';
import { Gift, GiftSchema } from './schemas/gift.schema';
import { GiftsController } from './gifts.controller';
import { GiftsService } from './gifts.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Gift.name, schema: GiftSchema },
      { name: GiftEvent.name, schema: GiftEventSchema },
    ]),
    UsersModule,
    WalletModule,
    RocketModule, // exposes RocketService for the gift-energy hook
  ],
  controllers: [GiftsController, AdminGiftsController],
  providers: [GiftsService],
  exports: [GiftsService],
})
export class GiftsModule {}
