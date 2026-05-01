import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { NotificationsModule } from '../notifications/notifications.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import {
  Conversation,
  ConversationSchema,
} from './schemas/conversation.schema';
import { Message, MessageSchema } from './schemas/message.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Conversation.name, schema: ConversationSchema },
      { name: Message.name, schema: MessageSchema },
      // Read-only access to User for hydrating peers in the inbox view.
      // We don't pull in UsersModule directly to avoid the circular
      // dependency that always shows up around auth.
      { name: User.name, schema: UserSchema },
    ]),
    RealtimeModule,
    // Drop a notification on the recipient when a brand-new
    // conversation begins, so the Notifications tab reflects DM
    // activity. (We don't notify on every reply — that would just
    // duplicate the inbox badge.)
    NotificationsModule,
  ],
  controllers: [MessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
