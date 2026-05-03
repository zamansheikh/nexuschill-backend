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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { MediaService } from '../media/media.service';
import { SocialService } from '../social/social.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersService } from './users.service';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const MAX_COVER_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly media: MediaService,
    private readonly social: SocialService,
  ) {}

  // ---------- Owner endpoints ----------

  @Get('me')
  async me(@CurrentUser() current: AuthenticatedUser) {
    const user = await this.users.getByIdOrThrow(current.userId);
    // Embed visitorsCount + family + svipLevel on the self response
    // so the "Me" tab and the self-as-public-profile flow can render
    // the full tile strip in one request. followersCount /
    // followingCount come for free — they're denormalized fields on
    // the user doc.
    const [visitorsCount, enrichment] = await Promise.all([
      this.social.visitorsCount(current.userId),
      this.users.getProfileEnrichment(current.userId),
    ]);
    const json = user.toJSON() as Record<string, any>;
    json.visitorsCount = visitorsCount;
    json.family = enrichment.family;
    json.svipLevel = enrichment.svipLevel;
    return { user: json };
  }

  @Patch('me')
  async updateMe(@CurrentUser() current: AuthenticatedUser, @Body() dto: UpdateProfileDto) {
    const user = await this.users.updateProfile(current.userId, dto);
    return { user };
  }

  @HttpCode(HttpStatus.OK)
  @Post('me/avatar')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_AVATAR_BYTES },
    }),
  )
  async uploadAvatar(
    @CurrentUser() current: AuthenticatedUser,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException({
        code: 'FILE_REQUIRED',
        message: 'Multipart field "file" is required',
      });
    }
    this.assertImage(file);

    const result = await this.media.uploadImage(file.buffer, {
      folder: `avatars`,
      publicId: `user-${current.userId}`,
      overwrite: true,
      transformation: [
        { width: 512, height: 512, crop: 'fill', gravity: 'face' },
        { quality: 'auto', fetch_format: 'auto' },
      ],
    });

    const user = await this.users.setAvatar(current.userId, result.secure_url, result.public_id);
    return { user };
  }

  @Delete('me/avatar')
  async deleteAvatar(@CurrentUser() current: AuthenticatedUser) {
    const user = await this.users.getByIdOrThrow(current.userId);
    if (user.avatarPublicId) {
      await this.media.deleteImage(user.avatarPublicId);
    }
    const updated = await this.users.setAvatar(current.userId, '', '');
    return { user: updated };
  }

  @HttpCode(HttpStatus.OK)
  @Post('me/cover')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_COVER_BYTES },
    }),
  )
  async uploadCover(
    @CurrentUser() current: AuthenticatedUser,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'File is required' });
    }
    this.assertImage(file);

    const result = await this.media.uploadImage(file.buffer, {
      folder: `covers`,
      publicId: `user-${current.userId}`,
      overwrite: true,
      transformation: [
        { width: 1500, height: 500, crop: 'fill' },
        { quality: 'auto', fetch_format: 'auto' },
      ],
    });

    const user = await this.users.setCoverPhoto(current.userId, result.secure_url, result.public_id);
    return { user };
  }

  // ---------- Public endpoints ----------

  @Get(':id')
  async publicProfile(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const user = await this.users.getByIdOrThrow(id);
    const json = this.users.toPublic(user);
    // Embed everything the mobile profile page needs for the visible
    // tile strip + Follow toggle in a single round-trip:
    //   • isFollowing — caller's perspective on this user.
    //   • visitorsCount — same three-tile stat strip the owner sees.
    //   • family — name + level for the "Family: …" line.
    //   • svipLevel — drives the SVIP1..9 chip; 0 means hidden.
    const [isFollowing, visitorsCount, enrichment] = await Promise.all([
      this.social.isFollowing(current.userId, id),
      this.social.visitorsCount(id),
      this.users.getProfileEnrichment(id),
    ]);
    (json as Record<string, unknown>).isFollowing = isFollowing;
    (json as Record<string, unknown>).visitorsCount = visitorsCount;
    (json as Record<string, unknown>).family = enrichment.family;
    (json as Record<string, unknown>).svipLevel = enrichment.svipLevel;
    return { user: json };
  }

  // ---------- helpers ----------

  private assertImage(file: Express.Multer.File) {
    if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
      throw new BadRequestException({
        code: 'INVALID_FILE_TYPE',
        message: `Only ${ALLOWED_IMAGE_TYPES.join(', ')} are allowed`,
        details: { received: file.mimetype },
      });
    }
  }
}
