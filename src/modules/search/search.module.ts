import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Room, RoomSchema } from '../rooms/schemas/room.schema';
import { SocialModule } from '../social/social.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Room.name, schema: RoomSchema },
      { name: User.name, schema: UserSchema },
    ]),
    // Used to filter blocked users out of search results — the
    // `hiddenUserIdsFor` helper gives us the symmetric blocker/blocked
    // set in one query so we can apply a single `$nin` to both the
    // user and room (owner) filters.
    SocialModule,
  ],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
