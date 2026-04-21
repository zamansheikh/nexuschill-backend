import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { AdminJwtPayload } from '../services/admin-token.service';

export interface AuthenticatedAdmin {
  adminId: string;
  role: string;
  roleId: string;
  permissions: string[];
  scopeType?: 'agency' | 'reseller' | null;
  scopeId?: string | null;
}

@Injectable()
export class AdminJwtStrategy extends PassportStrategy(Strategy, 'admin-jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('adminJwt.accessSecret') || '',
    });
  }

  async validate(payload: AdminJwtPayload): Promise<AuthenticatedAdmin> {
    if (payload.type !== 'admin') {
      throw new UnauthorizedException({
        code: 'WRONG_TOKEN_TYPE',
        message: 'This endpoint requires an admin token',
      });
    }
    return {
      adminId: payload.sub,
      role: payload.role,
      roleId: payload.roleId,
      permissions: payload.permissions,
      scopeType: payload.scopeType,
      scopeId: payload.scopeId,
    };
  }
}
