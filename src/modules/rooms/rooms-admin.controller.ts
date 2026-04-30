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

@Controller({ path: 'admin/rooms', version: '1' })
@AdminOnly()
export class RoomsAdminController {
  constructor(private readonly rooms: RoomsService) {}

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
}
