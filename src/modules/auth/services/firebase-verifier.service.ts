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

    // Load service-account credentials if available — same env vars as
    // FcmService. Critical: this service initializes Firebase Admin
    // first, so if we don't apply credentials here, FcmService later
    // sees an existing app (without creds) and reuses it. Result:
    // FCM sends silently no-op even when the service account env var
    // is set. Loading creds here means the SAME app handle is shared
    // across token verification AND FCM messaging.
    const serviceAccountJson = this.config.get<string>(
      'firebase.serviceAccountJson',
    );
    const serviceAccountPath = this.config.get<string>(
      'firebase.serviceAccountPath',
    );

    // Reuse an existing app if one is already initialized.
    if (admin.apps.length) {
      this.app = admin.apps[0]!;
      this.logger.log(
        `Firebase Admin reusing existing app for project "${projectId}"`,
      );
      return;
    }

    // Try to load service-account credentials. ANY failure here
    // (file missing, bad JSON, wrong path) is non-fatal — we fall
    // back to projectId-only init so Google sign-in keeps working.
    // FCM sends will silently no-op until the operator fixes the
    // credential path; that's better than breaking auth.
    let credential: admin.credential.Credential | undefined;
    try {
      if (serviceAccountJson) {
        credential = admin.credential.cert(JSON.parse(serviceAccountJson));
      } else if (serviceAccountPath) {
        credential = admin.credential.cert(serviceAccountPath);
      } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        credential = admin.credential.applicationDefault();
      }
    } catch (e) {
      this.logger.warn(
        `Failed to load Firebase service-account (FCM will be disabled): ${(e as Error).message}. ` +
          `Path tried: "${serviceAccountPath || '(none)'}". ` +
          `Continuing with projectId-only init.`,
      );
      credential = undefined;
    }

    try {
      this.app = admin.initializeApp({
        projectId,
        ...(credential ? { credential } : {}),
      });
      this.logger.log(
        credential
          ? `Firebase Admin initialized for project "${projectId}" (with credentials — FCM enabled)`
          : `Firebase Admin initialized for project "${projectId}" (no credentials — FCM disabled, verification only)`,
      );
    } catch (e) {
      this.logger.error(
        `Firebase Admin init failed: ${(e as Error).message}`,
      );
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
