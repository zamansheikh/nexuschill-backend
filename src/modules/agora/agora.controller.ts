import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AgoraService } from './agora.service';
import { RtcTokenDto, RtmTokenDto } from './dto/agora.dto';

/**
 * User-facing Agora endpoints. Auth is required — anonymous clients cannot
 * mint tokens, full-stop. The JWT here is the user's access token, not the
 * admin token.
 */
@Controller({ path: 'agora', version: '1' })
@UseGuards(JwtAuthGuard)
export class AgoraController {
  constructor(private readonly agora: AgoraService) {}

  @HttpCode(HttpStatus.OK)
  @Post('rtc-token')
  async rtcToken(@Body() dto: RtcTokenDto) {
    return this.agora.generateRtcToken({
      channelName: dto.channelName,
      uid: dto.uid,
      role: dto.role,
      expireSeconds: dto.expireSeconds,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('rtm-token')
  async rtmToken(@Body() dto: RtmTokenDto) {
    return this.agora.generateRtmToken({
      uid: dto.uid,
      expireSeconds: dto.expireSeconds,
    });
  }
}
