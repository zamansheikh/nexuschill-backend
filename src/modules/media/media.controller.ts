import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';

import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { GetUploadSignatureDto } from './dto/upload-signature.dto';
import { MediaService } from './media.service';

@Controller({ path: 'media', version: '1' })
export class MediaController {
  constructor(private readonly media: MediaService) {}

  /**
   * Returns a signed upload payload so the client can POST a file directly to
   * Cloudinary without going through our server. Cheaper for large media.
   *
   * Folders are scoped per-user to prevent users from overwriting each other:
   *   actual folder = `<root>/<requestedFolder>/<userId>`
   */
  @HttpCode(HttpStatus.OK)
  @Post('signature')
  async getSignature(
    @Body() dto: GetUploadSignatureDto,
    @CurrentUser() current: AuthenticatedUser,
  ) {
    return this.media.generateUploadSignature(`${dto.folder}/${current.userId}`, dto.publicId);
  }
}
