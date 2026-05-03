import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';

import { AdminOnly } from '../admin/admin-auth/decorators/admin-only.decorator';
import { CurrentAdmin } from '../admin/admin-auth/decorators/current-admin.decorator';
import { RequirePermissions } from '../admin/admin-auth/decorators/require-permissions.decorator';
import { AuthenticatedAdmin } from '../admin/admin-auth/strategies/admin-jwt.strategy';
import { PERMISSIONS } from '../admin/permissions.catalog';
import { RemoveRoomDto } from './dto/room.dto';
import { RoomsService } from './rooms.service';
import { RoomStatus } from './schemas/room.schema';

@Controller({ path: 'admin/rooms', version: '1' })
@AdminOnly()
export class RoomsAdminController {
  constructor(private readonly rooms: RoomsService) {}

  /** Paginated list with search + filter. Powers the admin panel
   *  rooms table — accepts ACTIVE/CLOSED/REMOVED in `status` so
   *  moderators can drill into removed rooms when reviewing past
   *  actions. `search` matches name (case-insensitive) or exact
   *  numericId; `country` filters by the denormalized owner code. */
  @RequirePermissions(PERMISSIONS.ROOMS_VIEW)
  @Get()
  async list(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: RoomStatus,
    @Query('country') country?: string,
    @Query('search') search?: string,
  ) {
    return this.rooms.adminList({ page, limit, status, country, search });
  }

  @RequirePermissions(PERMISSIONS.ROOMS_VIEW)
  @Get(':id')
  async snapshot(@Param('id') id: string) {
    return this.rooms.getSnapshot(id);
  }

  @RequirePermissions(PERMISSIONS.ROOMS_CLOSE)
  @Post(':id/remove')
  async remove(
    @Param('id') id: string,
    @Body() dto: RemoveRoomDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    const room = await this.rooms.adminRemove(id, dto.reason, admin.adminId);
    return { room: room.toJSON() };
  }

  /** Restore a REMOVED room back to ACTIVE. No DTO — restoring
   *  is a single-button action; the audit trail is captured by the
   *  admin auth log. Idempotent on already-ACTIVE rooms. */
  @RequirePermissions(PERMISSIONS.ROOMS_CLOSE)
  @Post(':id/restore')
  async restore(@Param('id') id: string) {
    const room = await this.rooms.adminRestore(id);
    return { room: room.toJSON() };
  }
}
