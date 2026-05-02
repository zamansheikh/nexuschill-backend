import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { AdminOnly } from '../admin/admin-auth/decorators/admin-only.decorator';
import { CurrentAdmin } from '../admin/admin-auth/decorators/current-admin.decorator';
import { RequirePermissions } from '../admin/admin-auth/decorators/require-permissions.decorator';
import { AuthenticatedAdmin } from '../admin/admin-auth/strategies/admin-jwt.strategy';
import { PERMISSIONS } from '../admin/permissions.catalog';
import {
  CreateMagicBallTaskDto,
  UpdateMagicBallTaskDto,
} from './dto/magic-ball.dto';
import { MagicBallService } from './magic-ball.service';
import { MagicBallTaskKind } from './schemas/magic-ball-task.schema';

/**
 * Admin CRUD for the Magic Ball task ladder. Mirrors the gifts /
 * cosmetics admin pattern — list with pagination, get one, create,
 * update, delete.
 */
@Controller({ path: 'admin/magic-ball', version: '1' })
@AdminOnly()
export class AdminMagicBallController {
  constructor(private readonly svc: MagicBallService) {}

  @RequirePermissions(PERMISSIONS.MAGIC_BALL_VIEW)
  @Get('tasks')
  async list(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('active') active?: string,
    @Query('kind') kind?: MagicBallTaskKind,
  ) {
    const activeBool = active === undefined ? undefined : active === 'true';
    return this.svc.listAdminTasks({ page, limit, active: activeBool, kind });
  }

  @RequirePermissions(PERMISSIONS.MAGIC_BALL_VIEW)
  @Get('tasks/:id')
  async getOne(@Param('id') id: string) {
    const task = await this.svc.getTaskOrThrow(id);
    return { task };
  }

  @RequirePermissions(PERMISSIONS.MAGIC_BALL_MANAGE)
  @Post('tasks')
  async create(
    @Body() dto: CreateMagicBallTaskDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    const task = await this.svc.createTask(dto, admin.adminId);
    return { task };
  }

  @RequirePermissions(PERMISSIONS.MAGIC_BALL_MANAGE)
  @Patch('tasks/:id')
  async update(@Param('id') id: string, @Body() dto: UpdateMagicBallTaskDto) {
    const task = await this.svc.updateTask(id, dto);
    return { task };
  }

  @RequirePermissions(PERMISSIONS.MAGIC_BALL_MANAGE)
  @Delete('tasks/:id')
  async remove(@Param('id') id: string) {
    await this.svc.deleteTask(id);
    return { ok: true };
  }
}
