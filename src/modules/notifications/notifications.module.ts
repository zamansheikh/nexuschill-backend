import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { RealtimeModule } from '../realtime/realtime.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import {
  Notification,
  NotificationSchema,
} from './schemas/notification.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
      // Read-only access to User for hydrating actor previews.
      { name: User.name, schema: UserSchema },
    ]),
    RealtimeModule,
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
