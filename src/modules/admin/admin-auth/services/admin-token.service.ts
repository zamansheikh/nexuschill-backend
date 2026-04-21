import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomBytes } from 'crypto';
import { Model, Types } from 'mongoose';

import { AdminRefreshToken, AdminRefreshTokenDocument } from '../schemas/admin-refresh-token.schema';

export interface AdminJwtPayload {
  sub: string;
  type: 'admin';
  role: string;
  roleId: string;
  permissions: string[];
  scopeType?: 'agency' | 'reseller' | null;
  scopeId?: string | null;
}

export interface AdminTokenPair {
  accessToken: string;
  refreshToken: string;
  accessExpiresIn: number;
  refreshExpiresIn: number;
}

@Injectable()
export class AdminTokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @InjectModel(AdminRefreshToken.name)
    private readonly refreshModel: Model<AdminRefreshTokenDocument>,
  ) {}

  async issue(
    payload: AdminJwtPayload,
    context?: { userAgent?: string; ipAddress?: string },
  ): Promise<AdminTokenPair> {
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get<string>('adminJwt.accessSecret'),
      expiresIn: this.config.get<string>('adminJwt.accessExpires'),
    });

    const rawRefresh = randomBytes(48).toString('base64url');
    const refreshExpiresSeconds = this.parseDuration(
      this.config.get<string>('adminJwt.refreshExpires', '7d'),
    );

    await this.refreshModel.create({
      adminId: new Types.ObjectId(payload.sub),
      tokenHash: this.hashToken(rawRefresh),
      expiresAt: new Date(Date.now() + refreshExpiresSeconds * 1000),
      userAgent: context?.userAgent,
      ipAddress: context?.ipAddress,
    });

    return {
      accessToken,
      refreshToken: rawRefresh,
      accessExpiresIn: this.parseDuration(
        this.config.get<string>('adminJwt.accessExpires', '30m'),
      ),
      refreshExpiresIn: refreshExpiresSeconds,
    };
  }

  async validateRefresh(rawToken: string): Promise<AdminRefreshTokenDocument> {
    const hash = this.hashToken(rawToken);
    const record = await this.refreshModel.findOne({ tokenHash: hash }).exec();

    if (!record) {
      throw new UnauthorizedException({
        code: 'REFRESH_INVALID',
        message: 'Invalid refresh token',
      });
    }
    if (record.revoked) {
      throw new UnauthorizedException({
        code: 'REFRESH_REVOKED',
        message: 'Refresh token has been revoked',
      });
    }
    if (record.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException({
        code: 'REFRESH_EXPIRED',
        message: 'Refresh token expired',
      });
    }
    return record;
  }

  async markReplaced(oldToken: AdminRefreshTokenDocument, newRawToken: string): Promise<void> {
    oldToken.revoked = true;
    oldToken.revokedAt = new Date();
    oldToken.replacedBy = this.hashToken(newRawToken);
    await oldToken.save();
  }

  async revoke(rawToken: string): Promise<void> {
    const hash = this.hashToken(rawToken);
    await this.refreshModel
      .updateOne(
        { tokenHash: hash, revoked: false },
        { $set: { revoked: true, revokedAt: new Date() } },
      )
      .exec();
  }

  async revokeAllForAdmin(adminId: string): Promise<void> {
    await this.refreshModel
      .updateMany(
        { adminId: new Types.ObjectId(adminId), revoked: false },
        { $set: { revoked: true, revokedAt: new Date() } },
      )
      .exec();
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private parseDuration(input: string): number {
    const match = /^(\d+)([smhd])$/.exec(input);
    if (!match) return 1800;
    const n = parseInt(match[1], 10);
    const unit = match[2];
    const mult = { s: 1, m: 60, h: 3600, d: 86400 }[unit] || 1;
    return n * mult;
  }
}
