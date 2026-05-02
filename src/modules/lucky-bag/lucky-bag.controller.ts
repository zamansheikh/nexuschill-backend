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

import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateLuckyBagDto } from './dto/lucky-bag.dto';
import { LuckyBagService } from './lucky-bag.service';

/**
 * Mobile-facing Lucky Bag endpoints. No admin surface in v1 — bags are
 * pure user-to-user; preset amounts/slots live on the client.
 */
@Controller({ path: 'lucky-bag', version: '1' })
export class LuckyBagController {
  constructor(private readonly svc: LuckyBagService) {}

  /** Drop a Lucky Bag in a room. Sender must have enough coins; backend
   *  debits them up-front, generates random slot amounts, persists, and
   *  broadcasts ROOM_LUCKY_BAG_SENT to every member. */
  @Post()
  async create(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: CreateLuckyBagDto,
  ) {
    const bag = await this.svc.create({
      senderId: current.userId,
      roomId: dto.roomId,
      totalCoins: dto.totalCoins,
      slotCount: dto.slotCount,
    });
    return { bag };
  }

  /** Claim the next slot. Idempotent per (bag, user) — a retry returns
   *  ALREADY_CLAIMED, never a second credit. */
  @Post(':id/claim')
  @HttpCode(HttpStatus.OK)
  async claim(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.svc.claim(id, current.userId);
  }

  /** Bags the caller has SENT — used on the History → Sent tab. */
  @Get('me/sent')
  async listMySent(
    @CurrentUser() current: AuthenticatedUser,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.svc.listSentBy(current.userId, { page, limit });
  }

  /** Bags where the caller pulled a slot — History → Received tab. */
  @Get('me/received')
  async listMyReceived(
    @CurrentUser() current: AuthenticatedUser,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.svc.listReceivedBy(current.userId, { page, limit });
  }

  /** Full bag detail — sender + every claim populated for the
   *  recipients-list page. */
  @Get(':id')
  async getOne(@Param('id') id: string) {
    const bag = await this.svc.getDetails(id);
    return { bag };
  }

  /** Active bags currently in flight in a room (used by clients that
   *  join mid-stream so they don't miss an in-progress card). */
  @Get('room/:roomId/active')
  async listActive(@Query('roomId') _ignored: string, @Param('roomId') roomId: string) {
    const items = await this.svc.listActiveInRoom(roomId);
    return { items };
  }
}
