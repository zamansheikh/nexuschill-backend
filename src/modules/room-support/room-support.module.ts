import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AdminAuthModule } from '../admin/admin-auth/admin-auth.module';
import {
  GiftEvent,
  GiftEventSchema,
} from '../gifts/schemas/gift-event.schema';
import {
  RoomMember,
  RoomMemberSchema,
} from '../rooms/schemas/room-member.schema';
import { Room, RoomSchema } from '../rooms/schemas/room.schema';
import { RoomSupportController } from './room-support.controller';
import { RoomSupportService } from './room-support.service';
import {
  RoomSupportConfig,
  RoomSupportConfigSchema,
} from './schemas/room-support-config.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: RoomSupportConfig.name, schema: RoomSupportConfigSchema },
      // Read-only references — registered here so this module can query
      // them directly without importing the full RoomsModule / GiftsModule
      // (those carry their own service+controller surface we don't need).
      { name: Room.name, schema: RoomSchema },
      { name: RoomMember.name, schema: RoomMemberSchema },
      { name: GiftEvent.name, schema: GiftEventSchema },
    ]),
    AdminAuthModule, // for the admin PATCH guard
  ],
  controllers: [RoomSupportController],
  providers: [RoomSupportService],
  exports: [RoomSupportService],
})
export class RoomSupportModule {}
