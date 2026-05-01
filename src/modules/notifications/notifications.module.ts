import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AdminAuthModule } from '../admin/admin-auth/admin-auth.module';
import { FcmModule } from '../fcm/fcm.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { NotificationsAdminController } from './notifications-admin.controller';
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
    // Every persisted notification fans out to FCM as well — the
    // realtime emit covers in-app, FCM covers backgrounded apps.
    FcmModule,
    // Admin guards + permissions for the broadcast endpoint.
    AdminAuthModule,
  ],
  controllers: [NotificationsController, NotificationsAdminController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
