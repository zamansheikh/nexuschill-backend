import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';

import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MediaService } from '../media/media.service';
import { CreateCommentDto, CreateMomentDto } from './dto/moment.dto';
import { MomentsService } from './moments.service';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB / image
const MAX_IMAGES = 9;
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

@Controller({ path: 'moments', version: '1' })
export class MomentsController {
  constructor(
    private readonly moments: MomentsService,
    private readonly media: MediaService,
  ) {}

  // ---------- Read ----------

  /**
   * Public feed. Auth is optional — when present, each item is annotated
   * with `likedByMe` so the heart paints correctly on first render.
   */
  @Public()
  @Get()
  async feed(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('authorId') authorId?: string,
    // The auth guard isn't applied, but if a JWT is present the request
    // pipeline still parses it via the global decorator. We accept null.
    @CurrentUser() current?: AuthenticatedUser,
  ) {
    return this.moments.listFeed(current?.userId ?? null, { page, limit, authorId });
  }

  // ---------- Write (auth required) ----------

  @UseGuards(JwtAuthGuard)
  @Post()
  async create(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: CreateMomentDto,
  ) {
    const m = await this.moments.create(current.userId, dto);
    return { moment: m };
  }

  /**
   * Multipart create — uploads up to 9 images to Cloudinary then writes
   * the moment in one round-trip from the client. Use this when posting
   * fresh photos straight from the camera roll; clients that already
   * have URLs (e.g. shared from elsewhere) should use the JSON `POST /`
   * instead.
   */
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('with-images')
  @UseInterceptors(
    FilesInterceptor('files', MAX_IMAGES, {
      limits: { fileSize: MAX_IMAGE_BYTES },
    }),
  )
  async createWithImages(
    @CurrentUser() current: AuthenticatedUser,
    @Body('text') text?: string,
    @UploadedFiles() files?: Array<Express.Multer.File>,
  ) {
    const list = files ?? [];
    for (const f of list) {
      if (!ALLOWED_TYPES.includes(f.mimetype)) {
        throw new BadRequestException({
          code: 'INVALID_IMAGE_TYPE',
          message: `Each image must be one of ${ALLOWED_TYPES.join(', ')}`,
          details: { received: f.mimetype },
        });
      }
    }
    const uploaded = await Promise.all(
      list.map(async (f) => {
        const res = await this.media.uploadImage(f.buffer, {
          folder: `moments/${current.userId}`,
        });
        return {
          url: res.secure_url,
          publicId: res.public_id,
          kind: 'image' as const,
          width: res.width ?? 0,
          height: res.height ?? 0,
        };
      }),
    );
    const m = await this.moments.create(current.userId, {
      text: text ?? '',
      media: uploaded,
    });
    return { moment: m };
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async deleteOwn(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    await this.moments.deleteOwn(id, current.userId);
    return { ok: true };
  }

  // ---------- Likes ----------

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post(':id/like')
  async like(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.moments.like(id, current.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id/like')
  async unlike(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.moments.unlike(id, current.userId);
  }

  // ---------- Comments ----------

  /** Public list — anyone can read comments on a moment. */
  @Public()
  @Get(':id/comments')
  async listComments(
    @Param('id') id: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.moments.listComments(id, { page, limit });
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/comments')
  async createComment(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateCommentDto,
  ) {
    const comment = await this.moments.createComment({
      momentId: id,
      authorId: current.userId,
      text: dto.text,
      parentId: dto.parentId,
    });
    return { comment };
  }

  @UseGuards(JwtAuthGuard)
  @Delete('comments/:commentId')
  async deleteOwnComment(
    @CurrentUser() current: AuthenticatedUser,
    @Param('commentId') commentId: string,
  ) {
    await this.moments.deleteOwnComment(commentId, current.userId);
    return { ok: true };
  }
}
