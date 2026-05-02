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

import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CreateFamilyDto, UpdateFamilyDto } from './dto/family.dto';
import { FamiliesService } from './families.service';
import { FamilyMemberStatus } from './schemas/family-member.schema';
import { FamilyStatus } from './schemas/family.schema';

/**
 * Mobile-facing family endpoints. The admin-facing surface lives in
 * admin-families.controller.ts under `/admin/families`.
 */
@Controller({ path: 'families', version: '1' })
export class FamiliesController {
  constructor(private readonly families: FamiliesService) {}

  /** Public family directory — anyone can browse / search. */
  @Public()
  @Get()
  async list(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
  ) {
    return this.families.list({ page, limit, search, status: FamilyStatus.ACTIVE });
  }

  /** Caller's current family (and their role within it), if any. */
  @Get('me')
  async me(@CurrentUser() current: AuthenticatedUser) {
    const { family, membership } = await this.families.findMyFamily(current.userId);
    return { family, membership };
  }

  /** Public read for the family detail page. */
  @Public()
  @Get(':id')
  async getOne(@Param('id') id: string) {
    const family = await this.families.getByIdOrThrow(id);
    return { family };
  }

  /** Active member roster — public, used to render the family page. */
  @Public()
  @Get(':id/members')
  async listMembers(
    @Param('id') id: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.families.listMembers(id, {
      page,
      limit,
      status: FamilyMemberStatus.ACTIVE,
    });
  }

  /** Pending join requests — only useful for leader / co-leaders. Auth required. */
  @Get(':id/requests')
  async listRequests(
    @Param('id') id: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    // The service already gates management actions on requests; reading the
    // list itself doesn't need the gate (the leader's UI is the only caller).
    return this.families.listMembers(id, {
      page,
      limit,
      status: FamilyMemberStatus.PENDING,
    });
  }

  // ----- Mutations -----

  @Post()
  async create(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: CreateFamilyDto,
  ) {
    const family = await this.families.create(dto, current.userId);
    return { family };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: UpdateFamilyDto,
  ) {
    const family = await this.families.update(id, dto, current.userId);
    return { family };
  }

  @Post(':id/join')
  async requestJoin(
    @Param('id') id: string,
    @CurrentUser() current: AuthenticatedUser,
  ) {
    const member = await this.families.requestJoin(id, current.userId);
    return { member };
  }

  @Post(':id/leave')
  async leave(
    @Param('id') id: string,
    @CurrentUser() current: AuthenticatedUser,
  ) {
    await this.families.leave(id, current.userId);
    return { success: true };
  }

  @Post(':id/requests/:userId/approve')
  async approveJoin(
    @Param('id') id: string,
    @Param('userId') pendingUserId: string,
    @CurrentUser() current: AuthenticatedUser,
  ) {
    const member = await this.families.approveJoin(id, pendingUserId, current.userId);
    return { member };
  }

  @Post(':id/requests/:userId/reject')
  async rejectJoin(
    @Param('id') id: string,
    @Param('userId') pendingUserId: string,
    @CurrentUser() current: AuthenticatedUser,
  ) {
    await this.families.rejectJoin(id, pendingUserId, current.userId);
    return { success: true };
  }

  @Delete(':id/members/:userId')
  async kick(
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @CurrentUser() current: AuthenticatedUser,
  ) {
    await this.families.kick(id, targetUserId, current.userId);
    return { success: true };
  }

  @Post(':id/members/:userId/promote')
  async promote(
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @CurrentUser() current: AuthenticatedUser,
  ) {
    const family = await this.families.promoteToCoLeader(id, targetUserId, current.userId);
    return { family };
  }

  @Post(':id/members/:userId/demote')
  async demote(
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @CurrentUser() current: AuthenticatedUser,
  ) {
    const family = await this.families.demoteCoLeader(id, targetUserId, current.userId);
    return { family };
  }

  @Post(':id/transfer/:userId')
  async transferLeadership(
    @Param('id') id: string,
    @Param('userId') newLeaderUserId: string,
    @CurrentUser() current: AuthenticatedUser,
  ) {
    const family = await this.families.transferLeadership(
      id,
      newLeaderUserId,
      current.userId,
    );
    return { family };
  }
}
