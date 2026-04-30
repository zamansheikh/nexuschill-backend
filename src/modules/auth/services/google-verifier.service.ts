import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client, TokenPayload } from 'google-auth-library';

@Injectable()
export class GoogleVerifierService {
  private readonly logger = new Logger(GoogleVerifierService.name);
  private readonly client = new OAuth2Client();

  constructor(private readonly config: ConfigService) {}

  /**
   * Verifies a Google ID token. Throws if invalid, expired, wrong audience,
   * or email isn't verified. Returns the validated payload.
   */
  async verify(idToken: string): Promise<TokenPayload> {
    const audiences = this.config.get<string[]>('google.clientIds') ?? [];
    if (audiences.length === 0) {
      this.logger.warn('GOOGLE_CLIENT_IDS not configured — Google sign-in disabled');
      throw new UnauthorizedException({
        code: 'GOOGLE_NOT_CONFIGURED',
        message: 'Google Sign-In is not configured on the server',
      });
    }

    let payload: TokenPayload | undefined;
    try {
      const ticket = await this.client.verifyIdToken({ idToken, audience: audiences });
      payload = ticket.getPayload();
    } catch (e) {
      this.logger.warn(`Google ID token verification failed: ${(e as Error).message}`);
      throw new UnauthorizedException({
        code: 'GOOGLE_TOKEN_INVALID',
        message: 'Invalid Google ID token',
      });
    }

    if (!payload) {
      throw new UnauthorizedException({
        code: 'GOOGLE_TOKEN_INVALID',
        message: 'Invalid Google ID token (no payload)',
      });
    }
    if (!payload.email) {
      throw new UnauthorizedException({
        code: 'GOOGLE_NO_EMAIL',
        message: 'Google account has no email',
      });
    }
    if (payload.email_verified === false) {
      throw new UnauthorizedException({
        code: 'GOOGLE_EMAIL_UNVERIFIED',
        message: 'Google email is not verified',
      });
    }
    if (!payload.sub) {
      throw new UnauthorizedException({
        code: 'GOOGLE_TOKEN_INVALID',
        message: 'Google ID token missing subject',
      });
    }

    return payload;
  }
}
