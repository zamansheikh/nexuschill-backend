import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomBytes } from 'crypto';
import { Model, Types } from 'mongoose';

import { RefreshToken, RefreshTokenDocument } from '../schemas/refresh-token.schema';

export interface JwtPayload {
  sub: string;
  email?: string;
  phone?: string;
  username?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessExpiresIn: number;
  refreshExpiresIn: number;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @InjectModel(RefreshToken.name)
    private readonly refreshModel: Model<RefreshTokenDocument>,
  ) {}

  async issueTokenPair(
    payload: JwtPayload,
    context?: { userAgent?: string; ipAddress?: string },
  ): Promise<TokenPair> {
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get<string>('jwt.accessSecret'),
      expiresIn: this.config.get<string>('jwt.accessExpires'),
    });

    const rawRefresh = randomBytes(48).toString('base64url');
    const refreshExpiresSeconds = this.parseDuration(this.config.get<string>('jwt.refreshExpires', '30d'));

    await this.refreshModel.create({
      userId: new Types.ObjectId(payload.sub),
      tokenHash: this.hashToken(rawRefresh),
      expiresAt: new Date(Date.now() + refreshExpiresSeconds * 1000),
      userAgent: context?.userAgent,
      ipAddress: context?.ipAddress,
    });

    return {
      accessToken,
      refreshToken: rawRefresh,
      accessExpiresIn: this.parseDuration(this.config.get<string>('jwt.accessExpires', '15m')),
      refreshExpiresIn: refreshExpiresSeconds,
    };
  }

  async rotate(
    oldRefreshToken: string,
    context?: { userAgent?: string; ipAddress?: string },
  ): Promise<TokenPair> {
    const hash = this.hashToken(oldRefreshToken);
    const record = await this.refreshModel.findOne({ tokenHash: hash }).exec();

    if (!record) throw new UnauthorizedException({ code: 'REFRESH_INVALID', message: 'Invalid refresh token' });
    if (record.revoked) throw new UnauthorizedException({ code: 'REFRESH_REVOKED', message: 'Refresh token has been revoked' });
    if (record.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException({ code: 'REFRESH_EXPIRED', message: 'Refresh token expired' });
    }

    const payload: JwtPayload = { sub: record.userId.toString() };
    const pair = await this.issueTokenPair(payload, context);

    record.revoked = true;
    record.revokedAt = new Date();
    record.replacedBy = this.hashToken(pair.refreshToken);
    await record.save();

    return pair;
  }

  async revoke(refreshToken: string): Promise<void> {
    const hash = this.hashToken(refreshToken);
    await this.refreshModel
      .updateOne(
        { tokenHash: hash, revoked: false },
        { $set: { revoked: true, revokedAt: new Date() } },
      )
      .exec();
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.refreshModel
      .updateMany(
        { userId: new Types.ObjectId(userId), revoked: false },
        { $set: { revoked: true, revokedAt: new Date() } },
      )
      .exec();
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private parseDuration(input: string): number {
    const match = /^(\d+)([smhd])$/.exec(input);
    if (!match) return 900;
    const n = parseInt(match[1], 10);
    const unit = match[2];
    const mult = { s: 1, m: 60, h: 3600, d: 86400 }[unit] || 1;
    return n * mult;
  }
}
