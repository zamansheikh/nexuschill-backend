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
    // Embed visitorsCount on the self response so the "Me" tab can
    // render its three stat tiles in one request. followersCount /
    // followingCount come for free — they're denormalized fields on
    // the user doc.
    const visitorsCount = await this.social.visitorsCount(current.userId);
    const json = user.toJSON() as Record<string, any>;
    json.visitorsCount = visitorsCount;
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
    // `isFollowing` is the caller's perspective on this user — used
    // by the mobile profile page + seat-actions sheet to render the
    // Follow / Following toggle without a second round trip.
    // Visitors count is included so the public profile renders the
    // same three-tile stat strip the owner sees.
    const [isFollowing, visitorsCount] = await Promise.all([
      this.social.isFollowing(current.userId, id),
      this.social.visitorsCount(id),
    ]);
    (json as Record<string, unknown>).isFollowing = isFollowing;
    (json as Record<string, unknown>).visitorsCount = visitorsCount;
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
