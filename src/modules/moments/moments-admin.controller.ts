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
import { RemoveMomentDto } from './dto/moment.dto';
import { MomentsService } from './moments.service';
import { MomentStatus } from './schemas/moment.schema';

@Controller({ path: 'admin/moments', version: '1' })
@AdminOnly()
export class MomentsAdminController {
  constructor(private readonly moments: MomentsService) {}

  @RequirePermissions(PERMISSIONS.MOMENTS_VIEW)
  @Get()
  async list(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: MomentStatus,
  ) {
    return this.moments.listAdmin({ page, limit, status });
  }

  @RequirePermissions(PERMISSIONS.MOMENTS_MODERATE)
  @Post(':id/remove')
  async remove(
    @Param('id') id: string,
    @Body() dto: RemoveMomentDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    const m = await this.moments.adminRemove(id, dto.reason, admin.adminId);
    return { moment: m };
  }

  @RequirePermissions(PERMISSIONS.MOMENTS_MODERATE)
  @Post(':id/restore')
  async restore(@Param('id') id: string) {
    const m = await this.moments.adminRestore(id);
    return { moment: m };
  }

  // Comments are flat under the moment — moderators remove by comment id.
  @RequirePermissions(PERMISSIONS.MOMENTS_MODERATE)
  @Post('comments/:commentId/remove')
  async removeComment(
    @Param('commentId') commentId: string,
    @Body() dto: RemoveMomentDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    const comment = await this.moments.adminRemoveComment(
      commentId,
      dto.reason,
      admin.adminId,
    );
    return { comment };
  }
}
