import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';

import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { RegisterTokenDto, UnregisterTokenDto } from './dto/register-token.dto';
import { FcmService } from './fcm.service';

@Controller({ path: 'fcm', version: '1' })
export class FcmController {
  constructor(private readonly fcm: FcmService) {}

  /** Mobile clients call this on cold start (after auth) and on
   *  every Firebase token refresh. Idempotent — repeat calls just
   *  bump `lastSeenAt`. */
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('tokens')
  async register(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: RegisterTokenDto,
  ) {
    await this.fcm.registerToken({
      userId: current.userId,
      token: dto.token,
      platform: dto.platform,
      locale: dto.locale,
    });
  }

  /** Drop the token on logout from this device (so the next user on
   *  the same handset doesn't inherit pushes). The body uses POST
   *  body so callers can send the (long) token without URL encoding. */
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('tokens')
  async unregister(@Body() dto: UnregisterTokenDto) {
    await this.fcm.unregisterToken(dto.token);
  }
}
