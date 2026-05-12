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
  SetMemberRoleDto,
  SubmitCreateRequestDto,
} from './dto/app-agency.dto';
import { AgencyJoinRequestStatus } from './schemas/agency-join-request.schema';

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
