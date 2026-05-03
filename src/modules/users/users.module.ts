import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Room, RoomSchema } from '../rooms/schemas/room.schema';
import { SocialModule } from '../social/social.module';
import { User, UserSchema } from './schemas/user.schema';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      // Read/write access to the Room collection so `updateProfile` can
      // sync the denormalized `ownerCountry` on every room owned by the
      // user when their country changes. We deliberately do NOT import
      // RoomsModule for this — that closed a Node-side import cycle
      // (UsersModule → RoomsModule → GiftsModule → UsersModule) that
      // crashed module loading with "imports[1] is undefined". Mongoose
      // models are singletons per connection, so registering the same
      // schema in two modules just gives both their own DI handle to
      // the same underlying model.
      { name: Room.name, schema: RoomSchema },
    ]),
    // SocialModule is a leaf in our module graph — it imports User
    // schema via forFeature but NOT UsersModule, so this arrow is
    // one-way and safe. Used to embed `isFollowing` + `visitorsCount`
    // on profile responses without forcing the mobile app to make
    // multiple round trips per profile open.
    SocialModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService, MongooseModule],
})
export class UsersModule {}
