import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';

import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { SendMessageDto } from './dto/send-message.dto';
import { MessagesService } from './messages.service';

@Controller({ path: 'messages', version: '1' })
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  /** Inbox — every conversation the caller is a participant in, newest
   *  first. Each row carries the peer + last-message preview + unread
   *  count, so the inbox renders without follow-up requests. */
  @Get('conversations')
  async listConversations(@CurrentUser() current: AuthenticatedUser) {
    const items = await this.messages.listConversations(current.userId);
    return { items };
  }

  /** Paginated message history for a conversation. `before` is a message
   *  id; pass the oldest one currently visible to fetch the next page
   *  going backwards in time. */
  @Get('conversations/:id/messages')
  async listMessages(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id') id: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    const items = await this.messages.listMessages(current.userId, id, {
      before,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
    });
    return { items };
  }

  /** Send a 1-1 message. Auto-creates the conversation on first send. */
  @HttpCode(HttpStatus.CREATED)
  @Post('send')
  async send(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: SendMessageDto,
  ) {
    const result = await this.messages.sendMessage(
      current.userId,
      dto.toUserId,
      dto.text,
    );
    return result;
  }

  /** Reset the caller's unread counter for the conversation to 0. */
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('conversations/:id/read')
  async markRead(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    await this.messages.markRead(current.userId, id);
  }
}
