import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { RealtimeModule } from '../realtime/realtime.module';
import { Room, RoomSchema } from '../rooms/schemas/room.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { WalletModule } from '../wallet/wallet.module';
import { LuckyBagController } from './lucky-bag.controller';
import { LuckyBagService } from './lucky-bag.service';
import { LuckyBag, LuckyBagSchema } from './schemas/lucky-bag.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: LuckyBag.name, schema: LuckyBagSchema },
      // Read-only references — the service hydrates sender + room
      // metadata for the global banner payload without dragging in
      // the full Users / Rooms modules (which would create cycles).
      { name: Room.name, schema: RoomSchema },
      { name: User.name, schema: UserSchema },
    ]),
    WalletModule, // sender debit + recipient credit
    RealtimeModule, // ROOM_LUCKY_BAG_SENT / _CLAIMED + GLOBAL banner broadcasts
  ],
  controllers: [LuckyBagController],
  providers: [LuckyBagService],
  exports: [LuckyBagService],
})
export class LuckyBagModule {}
