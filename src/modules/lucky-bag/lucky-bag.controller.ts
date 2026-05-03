import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AdminOnly } from '../admin/admin-auth/decorators/admin-only.decorator';
import { RequirePermissions } from '../admin/admin-auth/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../admin/permissions.catalog';
import {
  CreateLuckyBagDto,
  UpdateLuckyBagConfigDto,
} from './dto/lucky-bag.dto';
import { LuckyBagService } from './lucky-bag.service';

/**
 * Mobile-facing Lucky Bag endpoints + the admin config CRUD.
 * Admin endpoints are gated by `lucky_bag.view` / `lucky_bag.manage`
 * permissions — same role guard as the rest of the admin surface.
 */
@Controller({ path: 'lucky-bag', version: '1' })
export class LuckyBagController {
  constructor(private readonly svc: LuckyBagService) {}

  /** Public — mobile composer reads coin presets, slot tiers, and
   *  commission rate from this. Cached by client; refetched on
   *  composer open. */
  @Public()
  @Get('config')
  async getConfig() {
    const config = await this.svc.getConfig();
    return {
      enabled: config.enabled,
      commissionRate: config.commissionRate,
      applyCommissionByDefault: config.applyCommissionByDefault,
      coinPresets: config.coinPresets,
      tiers: config.tiers,
      composerShowDistributionMode: config.composerShowDistributionMode,
      composerDefaultDistributionMode: config.composerDefaultDistributionMode,
      openCountdownSeconds: config.openCountdownSeconds,
      claimWindowSeconds: config.claimWindowSeconds,
      maxConcurrentPerRoom: config.maxConcurrentPerRoom,
    };
  }

  /** Admin read — same shape as the public one but kept under /admin
   *  so the admin panel can require the matching permission. */
  @AdminOnly()
  @RequirePermissions(PERMISSIONS.LUCKY_BAG_VIEW)
  @Get('admin/config')
  async getAdminConfig() {
    const config = await this.svc.getConfig();
    return { config };
  }

  /** Admin write — partial patch. Each tier's percentages length must
   *  equal slotCount and sum to 1.0; service rejects with INVALID_TIER
   *  if either invariant is broken. */
  @AdminOnly()
  @RequirePermissions(PERMISSIONS.LUCKY_BAG_MANAGE)
  @Patch('admin/config')
  async updateAdminConfig(@Body() dto: UpdateLuckyBagConfigDto) {
    const config = await this.svc.updateConfig(dto);
    return { config };
  }

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
      distributionMode: dto.distributionMode,
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

  /** Sender-only cancel — refunds the unclaimed remainder back to the
   *  sender's wallet and emits a realtime event so every client drops
   *  the floating card. Used as the escape hatch for stuck bags AND
   *  general "I changed my mind" UX. */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.svc.cancel(id, current.userId);
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
