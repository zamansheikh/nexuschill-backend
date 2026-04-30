import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AgoraModule } from '../agora/agora.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { RoomsAdminController } from './rooms-admin.controller';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';
import { RoomMember, RoomMemberSchema } from './schemas/room-member.schema';
import { RoomSeat, RoomSeatSchema } from './schemas/room-seat.schema';
import { Room, RoomSchema } from './schemas/room.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Room.name, schema: RoomSchema },
      { name: RoomSeat.name, schema: RoomSeatSchema },
      { name: RoomMember.name, schema: RoomMemberSchema },
      // Read-only access to User for hydrating snapshots / blocked lists.
      // The full Users module isn't imported to avoid a circular dep.
      { name: User.name, schema: UserSchema },
    ]),
    AgoraModule,
  ],
  controllers: [RoomsController, RoomsAdminController],
  providers: [RoomsService],
  exports: [RoomsService],
})
export class RoomsModule {}
