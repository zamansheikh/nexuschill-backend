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
import {
  DeviceToken,
  DeviceTokenSchema,
} from '../fcm/schemas/device-token.schema';
import { HonorsModule } from '../honors/honors.module';
import { Room, RoomSchema } from '../rooms/schemas/room.schema';
import { SocialModule } from '../social/social.module';
import {
  UserSvipStatus,
  UserSvipStatusSchema,
} from '../svip/schemas/user-svip-status.schema';
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
      // Read-only access for profile enrichment (family name + SVIP
      // tier embedded on `/users/me` and `/users/:id`). Same
      // direct-Mongoose pattern as Room — avoids importing the full
      // FamiliesModule / SvipModule and the cycle risk that comes
      // with it.
      { name: Family.name, schema: FamilySchema },
      { name: FamilyMember.name, schema: FamilyMemberSchema },
      { name: UserSvipStatus.name, schema: UserSvipStatusSchema },
      // Direct model access so account deletion can drop the user's
      // push tokens atomically alongside the user-doc anonymisation,
      // without an indirect call into FcmModule (avoids a cycle —
      // FcmModule already imports UsersModule for auth context).
      { name: DeviceToken.name, schema: DeviceTokenSchema },
    ]),
    // SocialModule is a leaf in our module graph — it imports User
    // schema via forFeature but NOT UsersModule, so this arrow is
    // one-way and safe. Used to embed `isFollowing` + `visitorsCount`
    // on profile responses without forcing the mobile app to make
    // multiple round trips per profile open.
    SocialModule,
    // HonorsModule is also a leaf (no UsersModule dep) — exporting
    // HonorsService gives UsersController access to embed each user's
    // earned honors directly on `/users/:id` and `/users/me`. Saves
    // the mobile profile page a round-trip per open.
    HonorsModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService, MongooseModule],
})
export class UsersModule {}
