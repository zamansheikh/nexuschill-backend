import { Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

/**
 * Verifies Firebase ID tokens issued to the mobile client.
 *
 * Mobile flow:
 *   GoogleSignIn → Firebase Auth → firebaseUser.getIdToken() → backend.
 *
 * The mobile app does NOT need any Web Client ID — it auto-reads the OAuth
 * client from google-services.json. All the backend needs is the Firebase
 * project ID (the audience claim on Firebase ID tokens).
 */
@Injectable()
export class FirebaseVerifierService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseVerifierService.name);
  private app?: admin.app.App;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const projectId = this.config.get<string>('firebase.projectId');
    if (!projectId) {
      this.logger.warn(
        'FIREBASE_PROJECT_ID not set — Firebase token verification disabled. Google sign-in will fail.',
      );
      return;
    }

    try {
      // If an app is already initialized (e.g. from another import), reuse it.
      this.app = admin.apps.length
        ? admin.apps[0]!
        : admin.initializeApp({ projectId });
      this.logger.log(`Firebase Admin initialized for project "${projectId}"`);
    } catch (e) {
      this.logger.error(`Firebase Admin init failed: ${(e as Error).message}`);
    }
  }

  isReady(): boolean {
    return !!this.app;
  }

  /**
   * Verifies a Firebase ID token. Throws on invalid signature, expired,
   * wrong audience, or malformed.
   */
  async verify(idToken: string): Promise<admin.auth.DecodedIdToken> {
    if (!this.app) {
      throw new UnauthorizedException({
        code: 'FIREBASE_NOT_CONFIGURED',
        message: 'Firebase token verification is not configured on the server',
      });
    }
    try {
      // checkRevoked=false: just verify the JWT cryptographically (signature,
      // exp, iss, aud). Setting it to true would force a Firebase user lookup,
      // which requires service-account credentials we don't ship by default.
      const decoded = await admin.auth(this.app).verifyIdToken(idToken, false);
      if (!decoded.email) {
        throw new UnauthorizedException({
          code: 'FIREBASE_NO_EMAIL',
          message: 'Firebase user has no email',
        });
      }
      if (decoded.email_verified === false) {
        throw new UnauthorizedException({
          code: 'FIREBASE_EMAIL_UNVERIFIED',
          message: 'Email is not verified on this Firebase account',
        });
      }
      return decoded;
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      this.logger.warn(`Firebase ID token verification failed: ${(e as Error).message}`);
      throw new UnauthorizedException({
        code: 'FIREBASE_TOKEN_INVALID',
        message: 'Invalid Firebase ID token',
      });
    }
  }
}
