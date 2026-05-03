import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import {
  Family,
  FamilySchema,
} from '../families/schemas/family.schema';
import {
  FamilyMember,
  FamilyMemberSchema,
} from '../families/schemas/family-member.schema';
import { GiftEvent, GiftEventSchema } from '../gifts/schemas/gift-event.schema';
import { Room, RoomSchema } from '../rooms/schemas/room.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { RankingsController } from './rankings.controller';
import { RankingsService } from './rankings.service';

/**
 * Schemas registered via `forFeature` rather than importing the
 * `GiftsModule` / `UsersModule` / `RoomsModule` / `FamiliesModule` —
 * the cycle hazard we hit before (UsersModule → RoomsModule →
 * GiftsModule → UsersModule = undefined import) made the
 * direct-Mongoose pattern the safer default for any module whose
 * only need is read access to a few collections.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: GiftEvent.name, schema: GiftEventSchema },
      { name: User.name, schema: UserSchema },
      { name: Room.name, schema: RoomSchema },
      { name: Family.name, schema: FamilySchema },
      { name: FamilyMember.name, schema: FamilyMemberSchema },
    ]),
  ],
  controllers: [RankingsController],
  providers: [RankingsService],
  exports: [RankingsService],
})
export class RankingsModule {}
