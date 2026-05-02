import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AdminAuthModule } from '../admin/admin-auth/admin-auth.module';
import { RealtimeModule } from '../realtime/realtime.module';
import {
  RoomMember,
  RoomMemberSchema,
} from '../rooms/schemas/room-member.schema';
import { Room, RoomSchema } from '../rooms/schemas/room.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { WalletModule } from '../wallet/wallet.module';
import { RocketController } from './rocket.controller';
import { RocketCron } from './rocket.cron';
import { RocketService } from './rocket.service';
import {
  RocketConfig,
  RocketConfigSchema,
} from './schemas/rocket-config.schema';
import {
  RocketRoomState,
  RocketRoomStateSchema,
} from './schemas/rocket-room-state.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: RocketConfig.name, schema: RocketConfigSchema },
      { name: RocketRoomState.name, schema: RocketRoomStateSchema },
      // Read-only references for hydrating banner payloads + picking
      // active room members for the random-reward pool.
      { name: Room.name, schema: RoomSchema },
      { name: User.name, schema: UserSchema },
      { name: RoomMember.name, schema: RoomMemberSchema },
    ]),
    WalletModule, // credit recipients on launch
    RealtimeModule, // ROOM_ROCKET_LAUNCH + GLOBAL_ROCKET_BANNER broadcasts
    AdminAuthModule,
  ],
  controllers: [RocketController],
  providers: [RocketService, RocketCron],
  exports: [RocketService],
})
export class RocketModule {}
