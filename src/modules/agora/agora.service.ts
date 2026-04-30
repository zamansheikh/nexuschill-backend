import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { RtcRoleDto } from './dto/agora.dto';
import {
  AgoraConfig,
  AgoraConfigDocument,
} from './schemas/agora-config.schema';

// agora-access-token doesn't ship TS types; declare just what we touch.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const agora = require('agora-access-token') as {
  RtcTokenBuilder: {
    buildTokenWithUid: (
      appId: string,
      appCertificate: string,
      channelName: string,
      uid: number,
      role: number,
      privilegeExpiredTs: number,
    ) => string;
  };
  RtmTokenBuilder: {
    buildToken: (
      appId: string,
      appCertificate: string,
      uid: string,
      privilegeExpiredTs: number,
    ) => string;
  };
  RtcRole: { PUBLISHER: number; SUBSCRIBER: number };
};

const CONFIG_ID = 'default';

@Injectable()
export class AgoraService {
  private readonly logger = new Logger(AgoraService.name);

  constructor(
    @InjectModel(AgoraConfig.name)
    private readonly configModel: Model<AgoraConfigDocument>,
    private readonly env: ConfigService,
  ) {}

  // ============== Config (admin) ==============

  /**
   * Returns the singleton config doc, creating it from .env defaults on
   * first access. The .env path lets fresh deployments serve tokens
   * before an admin opens the settings page.
   */
  async getOrCreateConfig(): Promise<AgoraConfigDocument> {
    let cfg = await this.configModel.findById(CONFIG_ID).exec();
    if (!cfg) {
      const envAppId = this.env.get<string>('AGORA_APP_ID') ?? '';
      const envCert = this.env.get<string>('AGORA_APP_CERTIFICATE') ?? '';
      cfg = await this.configModel.create({
        _id: CONFIG_ID,
        appId: envAppId,
        appCertificate: envCert,
        defaultExpireSeconds: 3600,
        enabled: true,
      });
    }
    return cfg;
  }

  async updateConfig(
    input: {
      appId?: string;
      appCertificate?: string;
      defaultExpireSeconds?: number;
      enabled?: boolean;
    },
    updatedBy?: string,
  ): Promise<AgoraConfigDocument> {
    const cfg = await this.getOrCreateConfig();
    if (input.appId !== undefined) cfg.appId = input.appId.trim();
    // appCertificate semantics: empty string = "do not change". Admin form
    // intentionally leaves the field blank when the user isn't rotating.
    if (input.appCertificate !== undefined && input.appCertificate.length > 0) {
      cfg.appCertificate = input.appCertificate.trim();
    }
    if (input.defaultExpireSeconds !== undefined) {
      cfg.defaultExpireSeconds = input.defaultExpireSeconds;
    }
    if (input.enabled !== undefined) cfg.enabled = input.enabled;
    if (updatedBy && Types.ObjectId.isValid(updatedBy)) {
      cfg.updatedBy = new Types.ObjectId(updatedBy);
    }
    await cfg.save();
    return cfg;
  }

  /**
   * Admin-safe view: the certificate is masked except for the last 4 chars,
   * which is enough for an admin to confirm the right value is stored
   * without exposing it via the API.
   */
  toAdminView(cfg: AgoraConfigDocument) {
    const cert = cfg.appCertificate ?? '';
    const masked =
      cert.length > 4
        ? `${'•'.repeat(Math.max(0, cert.length - 4))}${cert.slice(-4)}`
        : cert.length > 0
          ? '•'.repeat(cert.length)
          : '';
    return {
      id: CONFIG_ID,
      appId: cfg.appId,
      appCertificateMasked: masked,
      hasAppCertificate: cert.length > 0,
      defaultExpireSeconds: cfg.defaultExpireSeconds,
      enabled: cfg.enabled,
      updatedAt: (cfg as any).updatedAt,
    };
  }

  // ============== Token minting ==============

  /**
   * RTC token — for joining a channel as publisher (host) or subscriber
   * (audience). Returns the token + the appId so the client doesn't need
   * to know it from a separate config call.
   */
  async generateRtcToken(params: {
    channelName: string;
    uid?: number;
    role?: RtcRoleDto;
    expireSeconds?: number;
  }): Promise<{
    token: string;
    appId: string;
    channelName: string;
    uid: number;
    role: RtcRoleDto;
    expireSeconds: number;
    expireAt: string;
  }> {
    const cfg = await this.assertReady();
    const role = params.role ?? RtcRoleDto.PUBLISHER;
    const rtcRole =
      role === RtcRoleDto.PUBLISHER
        ? agora.RtcRole.PUBLISHER
        : agora.RtcRole.SUBSCRIBER;
    const uid = params.uid ?? 0;
    const expireSeconds = params.expireSeconds ?? cfg.defaultExpireSeconds;
    const expiredAt = Math.floor(Date.now() / 1000) + expireSeconds;

    const token = agora.RtcTokenBuilder.buildTokenWithUid(
      cfg.appId,
      cfg.appCertificate,
      params.channelName,
      uid,
      rtcRole,
      expiredAt,
    );

    return {
      token,
      appId: cfg.appId,
      channelName: params.channelName,
      uid,
      role,
      expireSeconds,
      expireAt: new Date(expiredAt * 1000).toISOString(),
    };
  }

  /**
   * RTM token — for the Agora messaging SDK. UID is a string here.
   */
  async generateRtmToken(params: {
    uid: string;
    expireSeconds?: number;
  }): Promise<{
    token: string;
    appId: string;
    uid: string;
    expireSeconds: number;
    expireAt: string;
  }> {
    const cfg = await this.assertReady();
    const expireSeconds = params.expireSeconds ?? cfg.defaultExpireSeconds;
    const expiredAt = Math.floor(Date.now() / 1000) + expireSeconds;

    const token = agora.RtmTokenBuilder.buildToken(
      cfg.appId,
      cfg.appCertificate,
      params.uid,
      expiredAt,
    );

    return {
      token,
      appId: cfg.appId,
      uid: params.uid,
      expireSeconds,
      expireAt: new Date(expiredAt * 1000).toISOString(),
    };
  }

  // ============== helpers ==============

  private async assertReady(): Promise<AgoraConfigDocument> {
    const cfg = await this.getOrCreateConfig();
    if (!cfg.enabled) {
      throw new ServiceUnavailableException({
        code: 'AGORA_DISABLED',
        message: 'Agora live features are disabled',
      });
    }
    if (!cfg.appId || !cfg.appCertificate) {
      throw new ServiceUnavailableException({
        code: 'AGORA_NOT_CONFIGURED',
        message:
          'Agora App ID or App Certificate is not configured. Set them from the admin panel.',
      });
    }
    if (cfg.appId.length < 16) {
      throw new BadRequestException({
        code: 'AGORA_INVALID_APP_ID',
        message: 'Configured Agora App ID is invalid',
      });
    }
    return cfg;
  }
}
