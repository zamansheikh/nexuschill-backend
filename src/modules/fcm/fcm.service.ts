import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import * as admin from 'firebase-admin';
import { Model, Types } from 'mongoose';

import {
  DevicePlatform,
  DeviceToken,
  DeviceTokenDocument,
} from './schemas/device-token.schema';

export interface PushPayload {
  title: string;
  body: string;
  imageUrl?: string;
  /** Free-form data fields tunneled through to the client. The mobile
   *  side reads `linkKind` + `linkValue` for tap-to-deep-link. */
  data?: Record<string, string>;
}

@Injectable()
export class FcmService implements OnModuleInit {
  private readonly logger = new Logger(FcmService.name);
  private app?: admin.app.App;

  constructor(
    @InjectModel(DeviceToken.name)
    private readonly tokenModel: Model<DeviceTokenDocument>,
    private readonly config: ConfigService,
  ) {}

  // ============== Lifecycle ==============

  onModuleInit() {
    // Try to use a service account if one is configured (env var as
    // raw JSON OR a path to a JSON file). Fall back to Application
    // Default Credentials, which works on GCP / Cloud Run / via
    // GOOGLE_APPLICATION_CREDENTIALS. As a last resort fall back to
    // projectId-only — which is fine for ID-token verification but
    // CANNOT send FCM messages; we log a warning so the operator
    // knows pushes will be no-ops.
    const projectId = this.config.get<string>('firebase.projectId');
    const serviceAccountJson = this.config.get<string>(
      'firebase.serviceAccountJson',
    );
    const serviceAccountPath = this.config.get<string>(
      'firebase.serviceAccountPath',
    );

    try {
      const existing = admin.apps.length ? admin.apps[0]! : null;
      if (existing) {
        // Already initialized by FirebaseVerifierService. Reuse it
        // — but warn if it was the credential-less init, since FCM
        // sends will fail with that.
        this.app = existing;
        if (!serviceAccountJson && !serviceAccountPath) {
          this.logger.warn(
            'Firebase Admin already initialized without a service account. ' +
              'FCM sends will fail — set FIREBASE_SERVICE_ACCOUNT_JSON or ' +
              'FIREBASE_SERVICE_ACCOUNT_PATH or GOOGLE_APPLICATION_CREDENTIALS.',
          );
        }
        return;
      }

      let credential: admin.credential.Credential | undefined;
      if (serviceAccountJson) {
        const parsed = JSON.parse(serviceAccountJson);
        credential = admin.credential.cert(parsed);
      } else if (serviceAccountPath) {
        credential = admin.credential.cert(serviceAccountPath);
      } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        credential = admin.credential.applicationDefault();
      }

      if (!credential && !projectId) {
        this.logger.warn(
          'Firebase not configured — neither service account nor projectId set. FCM disabled.',
        );
        return;
      }

      this.app = admin.initializeApp({
        ...(credential ? { credential } : {}),
        ...(projectId ? { projectId } : {}),
      });
      this.logger.log(
        credential
          ? 'Firebase Admin initialized with credentials (FCM enabled)'
          : 'Firebase Admin initialized projectId-only (FCM disabled — verification only)',
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

  // ============== Token registry ==============

  /** Register or refresh a token for a user. Idempotent — if the token
   *  already exists under a different user (device transfer), we
   *  re-attach it. */
  async registerToken(params: {
    userId: string;
    token: string;
    platform?: DevicePlatform;
    locale?: string;
  }): Promise<void> {
    if (!Types.ObjectId.isValid(params.userId)) return;
    const userOid = new Types.ObjectId(params.userId);
    await this.tokenModel.updateOne(
      { token: params.token },
      {
        $set: {
          userId: userOid,
          platform: params.platform ?? DevicePlatform.UNKNOWN,
          locale: params.locale ?? '',
          lastSeenAt: new Date(),
        },
      },
      { upsert: true },
    );
  }

  /** Drop a single token — typically called on logout from the
   *  device. */
  async unregisterToken(token: string): Promise<void> {
    await this.tokenModel.deleteOne({ token }).exec();
  }

  // ============== Send ==============

  /** Push to every device of [userId]. Silently no-ops if FCM isn't
   *  configured or the user has no registered tokens. Stale tokens
   *  (rejected by FCM) are removed lazily. */
  async sendToUser(userId: string, payload: PushPayload): Promise<number> {
    if (!Types.ObjectId.isValid(userId)) return 0;
    if (!this.app) return 0;
    const tokens = await this.tokenModel
      .find({ userId: new Types.ObjectId(userId) })
      .select('token')
      .lean()
      .exec();
    if (tokens.length === 0) return 0;
    return this.sendToTokens(tokens.map((t) => t.token), payload);
  }

  /** Push to many users — used by admin broadcast. Splits into
   *  batches of 500 (FCM's hard cap on `sendEachForMulticast`). */
  async sendToUsers(
    userIds: string[],
    payload: PushPayload,
  ): Promise<number> {
    if (userIds.length === 0) return 0;
    if (!this.app) return 0;
    const oids = userIds
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (oids.length === 0) return 0;
    const tokens = await this.tokenModel
      .find({ userId: { $in: oids } })
      .select('token')
      .lean()
      .exec();
    if (tokens.length === 0) return 0;
    return this.sendToTokens(tokens.map((t) => t.token), payload);
  }

  /** Broadcast to every registered device on the platform. Use with
   *  care — typically only for admin announcements. */
  async sendToAll(payload: PushPayload): Promise<number> {
    if (!this.app) return 0;
    const tokens = await this.tokenModel
      .find({})
      .select('token')
      .lean()
      .exec();
    if (tokens.length === 0) return 0;
    return this.sendToTokens(tokens.map((t) => t.token), payload);
  }

  // ============== Internals ==============

  /** Multicast to up to N tokens. Splits into 500-token batches and
   *  sweeps invalidated tokens after each batch. */
  private async sendToTokens(
    tokens: string[],
    payload: PushPayload,
  ): Promise<number> {
    if (!this.app || tokens.length === 0) return 0;
    let delivered = 0;
    const messaging = admin.messaging(this.app);
    for (let i = 0; i < tokens.length; i += 500) {
      const batch = tokens.slice(i, i + 500);
      try {
        const response = await messaging.sendEachForMulticast({
          tokens: batch,
          notification: {
            title: payload.title,
            body: payload.body,
            ...(payload.imageUrl ? { imageUrl: payload.imageUrl } : {}),
          },
          // String-only data fields per FCM contract. Convert
          // anything caller passes to a string up front.
          data: payload.data
            ? Object.fromEntries(
                Object.entries(payload.data).map(([k, v]) => [k, String(v)]),
              )
            : undefined,
          android: {
            priority: 'high',
            notification: {
              // Default channel — the mobile FcmService creates this
              // on Android 8+ during init.
              channelId: 'default',
            },
          },
          apns: {
            payload: {
              aps: { sound: 'default', badge: 1 },
            },
          },
        });
        delivered += response.successCount;
        // Sweep invalidated tokens. FCM tells us which ones via
        // per-response error codes — anything UNREGISTERED or
        // INVALID_ARGUMENT means "throw it away".
        const stale: string[] = [];
        response.responses.forEach((r, idx) => {
          if (r.success) return;
          const code = r.error?.code ?? '';
          if (
            code.includes('registration-token-not-registered') ||
            code.includes('invalid-argument') ||
            code.includes('not-found')
          ) {
            stale.push(batch[idx]);
          }
        });
        if (stale.length > 0) {
          await this.tokenModel
            .deleteMany({ token: { $in: stale } })
            .exec();
          this.logger.debug(`Cleaned ${stale.length} stale FCM tokens`);
        }
      } catch (e) {
        this.logger.warn(`FCM batch send failed: ${(e as Error).message}`);
      }
    }
    return delivered;
  }
}
