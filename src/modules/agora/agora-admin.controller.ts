import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
} from '@nestjs/common';

import { AdminOnly } from '../admin/admin-auth/decorators/admin-only.decorator';
import { CurrentAdmin } from '../admin/admin-auth/decorators/current-admin.decorator';
import { RequirePermissions } from '../admin/admin-auth/decorators/require-permissions.decorator';
import { AuthenticatedAdmin } from '../admin/admin-auth/strategies/admin-jwt.strategy';
import { PERMISSIONS } from '../admin/permissions.catalog';
import { AgoraService } from './agora.service';
import { UpdateAgoraConfigDto } from './dto/agora.dto';

@Controller({ path: 'admin/agora', version: '1' })
@AdminOnly()
export class AgoraAdminController {
  constructor(private readonly agora: AgoraService) {}

  /**
   * Returns the config with the certificate masked. Admin form uses
   * `hasAppCertificate` to decide whether to show "(set, leave blank to
   * keep)" or "(not set)" for the certificate field.
   */
  @RequirePermissions(PERMISSIONS.AGORA_VIEW)
  @Get('config')
  async get() {
    const cfg = await this.agora.getOrCreateConfig();
    return { config: this.agora.toAdminView(cfg) };
  }

  @RequirePermissions(PERMISSIONS.AGORA_MANAGE)
  @Patch('config')
  async update(
    @Body() dto: UpdateAgoraConfigDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    const cfg = await this.agora.updateConfig(dto, admin.adminId);
    return { config: this.agora.toAdminView(cfg) };
  }

  /**
   * Quick "is the certificate I just typed actually valid?" check. Mints a
   * throwaway token against a synthetic channel; if Agora's signing throws,
   * we surface that as a 400 so the admin can fix the value before users
   * hit broken token requests.
   */
  @RequirePermissions(PERMISSIONS.AGORA_MANAGE)
  @HttpCode(HttpStatus.OK)
  @Post('config/test')
  async test() {
    const out = await this.agora.generateRtcToken({
      channelName: 'admin-test',
      uid: 0,
      expireSeconds: 60,
    });
    return { ok: true, expireAt: out.expireAt, appId: out.appId };
  }
}
