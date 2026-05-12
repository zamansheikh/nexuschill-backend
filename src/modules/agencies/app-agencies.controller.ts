import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { MediaService } from '../media/media.service';
import { AppAgenciesService } from './app-agencies.service';
import {
  CreateMyAgencyDto,
  DecideRequestDto,
  JoinRequestDto,
  ManageCreateAgencyDto,
  ManageDecideCreateRequestDto,
  ManageSetAgencyStatusDto,
  ManageUpdateAgencyDto,
  SetMemberRoleDto,
  SubmitCreateRequestDto,
} from './dto/app-agency.dto';
import { AgencyCreateRequestStatus } from './schemas/agency-create-request.schema';
import { AgencyJoinRequestStatus } from './schemas/agency-join-request.schema';
import { AgencyMemberRole } from './schemas/agency-member.schema';
import { AgencyStatus } from './schemas/agency.schema';

const MAX_AGENCY_ASSET_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_ASSET_KINDS = ['logo', 'idFront', 'idBack'] as const;
type AgencyAssetKind = (typeof ALLOWED_ASSET_KINDS)[number];

/**
 * Mobile-facing agency endpoints. The admin panel still owns the
 * platform CRUD via `AgenciesController` at `/v1/admin/agencies`.
 *
 * Here we expose:
 *   • Public browse — anyone can look up agencies (used by the Browse
 *     screen on the My Agency page).
 *   • Authenticated `/me` — the caller's agency situation in one call.
 *   • Join / leave / cancel — the membership lifecycle.
 *   • Owner / admin actions — roster, ranking, join-requests, decide,
 *     kick, role change.
 *   • Create-from-app — gated on `User.agencyPowers` containing
 *     `agency.create`.
 */
@Controller({ path: 'agencies', version: '1' })
export class AppAgenciesController {
  constructor(
    private readonly agencies: AppAgenciesService,
    private readonly media: MediaService,
  ) {}

  // ─── Discovery ───────────────────────────────────────────────

  @Public()
  @Get()
  async list(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
  ) {
    return this.agencies.listPublic({ page, limit, search });
  }

  /** Top agencies — drives the My Agency empty-state leaderboard. */
  @Public()
  @Get('top')
  async top(@Query('limit') limit?: number) {
    return this.agencies.topAgencies(limit ?? 5);
  }

  @Get('me')
  async fetchMine(@CurrentUser() current: AuthenticatedUser) {
    return this.agencies.fetchMine(current.userId);
  }

  // ─── Agency creation requests (user-submitted, admin-approved) ───

  @Post('create-requests')
  async submitCreateRequest(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: SubmitCreateRequestDto,
  ) {
    const request = await this.agencies.submitCreateRequest(current.userId, dto);
    return { request };
  }

  /**
   * Multipart image upload helper for the create-request form. The
   * form needs three image URLs (agency logo + ID card front/back)
   * before submitting; rather than wire a separate signed-upload flow
   * for each, the mobile client POSTs the file here and gets back a
   * Cloudinary URL it can attach to the create-request payload.
   *
   * `kind` controls the Cloudinary subfolder so admins can find the
   * assets later if they need to spot-check KYC.
   */
  @HttpCode(HttpStatus.OK)
  @Post('create-requests/uploads')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_AGENCY_ASSET_BYTES },
    }),
  )
  async uploadCreateRequestAsset(
    @CurrentUser() current: AuthenticatedUser,
    @Body('kind') kind?: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException({
        code: 'FILE_REQUIRED',
        message: 'Multipart field "file" is required',
      });
    }
    if (!file.mimetype || !ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
      throw new BadRequestException({
        code: 'INVALID_IMAGE_TYPE',
        message: 'Only JPEG, PNG or WebP images are allowed',
      });
    }
    const safeKind: AgencyAssetKind = (ALLOWED_ASSET_KINDS as readonly string[])
      .includes(kind ?? '')
      ? (kind as AgencyAssetKind)
      : 'logo';
    const folder =
      safeKind === 'logo'
        ? 'agency-requests/logos'
        : safeKind === 'idFront'
          ? 'agency-requests/id-front'
          : 'agency-requests/id-back';

    const result = await this.media.uploadImage(file.buffer, {
      folder,
      // Distinct asset per user per kind, overwriting prior uploads so
      // the user can re-pick a photo without leaving orphans.
      publicId: `${safeKind}-${current.userId}`,
      overwrite: true,
      transformation: [
        {
          width: safeKind === 'logo' ? 512 : 1280,
          crop: 'limit',
        },
        { quality: 'auto', fetch_format: 'auto' },
      ],
    });
    return { url: result.secure_url, publicId: result.public_id };
  }

  @Get('create-requests/me')
  async listMyCreateRequests(@CurrentUser() current: AuthenticatedUser) {
    return this.agencies.listMyCreateRequests(current.userId);
  }

  @Post('create-requests/:reqId/cancel')
  async cancelMyCreateRequest(
    @CurrentUser() current: AuthenticatedUser,
    @Param('reqId') reqId: string,
  ) {
    return this.agencies.cancelMyCreateRequest(current.userId, reqId);
  }

  // ─── Admin-lite (gated on `agency.manage` power) ─────────────
  //
  // Mirrors the admin panel's agency CRUD + create-request approval
  // queue, scoped to a single user power. Every endpoint below
  // re-checks the power in the service layer — the prefix itself is
  // not a separate guard.

  @Get('manage')
  async manageList(
    @CurrentUser() current: AuthenticatedUser,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: AgencyStatus,
    @Query('country') country?: string,
    @Query('search') search?: string,
  ) {
    return this.agencies.manageList(current.userId, {
      page,
      limit,
      status,
      country,
      search,
    });
  }

  @Get('manage/create-requests')
  async manageListCreateRequests(
    @CurrentUser() current: AuthenticatedUser,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: AgencyCreateRequestStatus,
  ) {
    return this.agencies.manageListCreateRequests(current.userId, {
      page,
      limit,
      status,
    });
  }

  @Post('manage/create-requests/:reqId/approve')
  async manageApproveCreateRequest(
    @CurrentUser() current: AuthenticatedUser,
    @Param('reqId') reqId: string,
    @Body() dto: ManageDecideCreateRequestDto,
  ) {
    const { request, agency } = await this.agencies.manageApproveCreateRequest(
      current.userId,
      reqId,
      dto.note ?? '',
    );
    return { request, agency };
  }

  @Post('manage/create-requests/:reqId/reject')
  async manageRejectCreateRequest(
    @CurrentUser() current: AuthenticatedUser,
    @Param('reqId') reqId: string,
    @Body() dto: ManageDecideCreateRequestDto,
  ) {
    const request = await this.agencies.manageRejectCreateRequest(
      current.userId,
      reqId,
      dto.note ?? '',
    );
    return { request };
  }

  @Post('manage')
  async manageCreate(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: ManageCreateAgencyDto,
  ) {
    const agency = await this.agencies.manageCreate(current.userId, dto);
    return { agency };
  }

  @Get('manage/:id')
  async manageGet(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const agency = await this.agencies.manageGet(current.userId, id);
    return { agency };
  }

  @Patch('manage/:id')
  async manageUpdate(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ManageUpdateAgencyDto,
  ) {
    const agency = await this.agencies.manageUpdate(current.userId, id, dto);
    return { agency };
  }

  @Patch('manage/:id/status')
  async manageSetStatus(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ManageSetAgencyStatusDto,
  ) {
    const agency = await this.agencies.manageSetStatus(
      current.userId,
      id,
      dto.status,
    );
    return { agency };
  }

  /**
   * Admin-lite transfer ownership — for users holding `agency.manage`
   * who don't have to be a member of the agency themselves.
   */
  @Post('manage/:id/transfer-ownership')
  async manageTransferOwnership(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { newOwnerUserId?: string; demoteTo?: string },
  ) {
    if (!body.newOwnerUserId) {
      throw new BadRequestException({
        code: 'MISSING_USER_ID',
        message: 'newOwnerUserId is required',
      });
    }
    const demoteTo =
      body.demoteTo === 'member'
        ? AgencyMemberRole.MEMBER
        : AgencyMemberRole.ADMIN;
    return this.agencies.manageTransferOwnership(
      current.userId,
      id,
      body.newOwnerUserId,
      demoteTo,
    );
  }

  // ─── Membership lifecycle ───────────────────────────────────

  @Post(':id/join')
  async requestJoin(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: JoinRequestDto,
  ) {
    const req = await this.agencies.requestJoin(
      current.userId,
      id,
      dto.message ?? '',
    );
    return { request: req };
  }

  @Post('requests/:reqId/cancel')
  async cancelMyRequest(
    @CurrentUser() current: AuthenticatedUser,
    @Param('reqId') reqId: string,
  ) {
    return this.agencies.cancelMyRequest(current.userId, reqId);
  }

  @Post('leave')
  async leave(@CurrentUser() current: AuthenticatedUser) {
    return this.agencies.leaveAgency(current.userId);
  }

  // ─── Roster + ranking ───────────────────────────────────────

  @Get(':id/members')
  async listMembers(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id') id: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.agencies.listMembers(id, { page, limit }, current.userId);
  }

  @Get(':id/ranking')
  async ranking(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id') id: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.agencies.ranking(id, { page, limit }, current.userId);
  }

  // ─── Join request moderation ────────────────────────────────

  @Get(':id/join-requests')
  async listJoinRequests(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id') id: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: AgencyJoinRequestStatus,
  ) {
    return this.agencies.listJoinRequests(
      id,
      { page, limit, status },
      current.userId,
    );
  }

  @Post(':id/join-requests/:reqId/decide')
  async decideRequest(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id') id: string,
    @Param('reqId') reqId: string,
    @Body() dto: DecideRequestDto,
  ) {
    return this.agencies.decideRequest(
      id,
      reqId,
      current.userId,
      dto.decision,
      dto.note ?? '',
    );
  }

  // ─── Member moderation ─────────────────────────────────────

  @Delete(':id/members/:userId')
  async kickMember(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.agencies.kickMember(id, userId, current.userId);
  }

  /**
   * Owner-driven ownership transfer. Available to the current owner
   * of the agency (anyone holding `agency.manage` should use
   * `/agencies/manage/:id/transfer-ownership` instead, which doesn't
   * require membership in the target agency).
   */
  @Post(':id/transfer-ownership')
  async transferOwnership(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { newOwnerUserId?: string; demoteTo?: string },
  ) {
    if (!body.newOwnerUserId) {
      throw new BadRequestException({
        code: 'MISSING_USER_ID',
        message: 'newOwnerUserId is required',
      });
    }
    const demoteTo =
      body.demoteTo === 'member'
        ? AgencyMemberRole.MEMBER
        : AgencyMemberRole.ADMIN;
    return this.agencies.transferOwnership(
      current.userId,
      id,
      body.newOwnerUserId,
      demoteTo,
    );
  }

  @Patch(':id/members/:userId/role')
  async setMemberRole(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() dto: SetMemberRoleDto,
  ) {
    const { member } = await this.agencies.setMemberRole(
      id,
      userId,
      current.userId,
      dto.role,
    );
    return { member };
  }

  // ─── Found a new agency ─────────────────────────────────────

  @Post()
  async createMine(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: CreateMyAgencyDto,
  ) {
    const { agency, member } = await this.agencies.createFromApp(
      current.userId,
      dto,
    );
    return { agency, member };
  }
}
