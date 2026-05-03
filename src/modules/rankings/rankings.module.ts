import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { GiftEvent, GiftEventSchema } from '../gifts/schemas/gift-event.schema';
import { Room, RoomSchema } from '../rooms/schemas/room.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { RankingsController } from './rankings.controller';
import { RankingsService } from './rankings.service';

/**
 * Three schemas registered via `forFeature` rather than importing
 * `GiftsModule` / `UsersModule` / `RoomsModule` — the cycle hazard
 * we hit before (UsersModule → RoomsModule → GiftsModule →
 * UsersModule = undefined import) made the direct-Mongoose pattern
 * the safer default for any module whose only need is read access
 * to a few collections.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: GiftEvent.name, schema: GiftEventSchema },
      { name: User.name, schema: UserSchema },
      { name: Room.name, schema: RoomSchema },
    ]),
  ],
  controllers: [RankingsController],
  providers: [RankingsService],
  exports: [RankingsService],
})
export class RankingsModule {}
