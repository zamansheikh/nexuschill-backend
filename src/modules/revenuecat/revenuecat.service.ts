import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  RechargePackage,
  RechargePackageDocument,
} from '../wallet/schemas/recharge-package.schema';
import {
  Currency,
  TxnType,
} from '../wallet/schemas/transaction.schema';
import { WalletService } from '../wallet/wallet.service';
import { RevenueCatEvent } from './dto/revenuecat-webhook.dto';

/**
 * Why a separate module for this:
 *   • Webhooks are public (RC calls us from their IP — no JWT) but are
 *     gated by a shared-secret Authorization header. Keeping them out
 *     of WalletModule keeps the wallet's auth surface clean.
 *   • Idempotency is enforced via the existing `wallet.credit()` path
 *     — same key flow as admin mints. We just construct a stable key
 *     from the RC event id and call straight in.
 */
@Injectable()
export class RevenueCatService {
  private readonly logger = new Logger(RevenueCatService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly wallets: WalletService,
    @InjectModel(RechargePackage.name)
    private readonly packageModel: Model<RechargePackageDocument>,
  ) {}

  /** Returns true iff the request's Authorization header matches our
   *  configured secret byte-for-byte. Empty config = always reject so
   *  a misconfigured deploy doesn't silently accept anonymous traffic. */
  isAuthorized(authHeader: string | undefined): boolean {
    const expected = this.config.get<string>('revenuecat.webhookAuth') ?? '';
    if (expected.length === 0) {
      this.logger.warn(
        'REVENUECAT_WEBHOOK_AUTH not set — rejecting all RevenueCat webhooks',
      );
      return false;
    }
    return typeof authHeader === 'string' && authHeader === expected;
  }

  /**
   * Process one webhook event. Returns a small status object for the
   * controller to log; HTTP-level errors (auth, malformed payload) are
   * raised by the controller before this is called.
   */
  async handleEvent(event: RevenueCatEvent): Promise<{
    status: 'credited' | 'ignored' | 'unknown_product' | 'sandbox_dropped' | 'no_user';
    detail?: string;
  }> {
    // ---- 1. Filter to billable events ----
    // Only consumable / one-shot purchase events credit coins. Renewal
    // belongs to subscriptions — we don't ship subs today, so just log.
    const billable =
      event.type === 'INITIAL_PURCHASE' ||
      event.type === 'NON_RENEWING_PURCHASE';
    if (!billable) {
      return { status: 'ignored', detail: `event type=${event.type}` };
    }

    // ---- 2. Sandbox guard ----
    const acceptSandbox =
      this.config.get<boolean>('revenuecat.acceptSandbox') ?? false;
    if (event.environment === 'SANDBOX' && !acceptSandbox) {
      return { status: 'sandbox_dropped' };
    }

    // ---- 3. Resolve user ----
    const userId = (event.app_user_id ?? '').trim();
    if (!userId) {
      this.logger.warn(
        `RC webhook ${event.id} missing app_user_id — dropping`,
      );
      return { status: 'no_user' };
    }

    // ---- 4. Resolve package by store-specific product id ----
    const productId = (event.product_id ?? '').trim();
    if (!productId) {
      this.logger.warn(`RC webhook ${event.id} missing product_id`);
      return { status: 'unknown_product' };
    }
    // Match either the Google or Apple field — RC puts the store sku in
    // `product_id` and tells us which side via `store`. We accept both
    // keys for robustness against re-platforming.
    const pkg = await this.packageModel
      .findOne({
        active: true,
        $or: [{ googleProductId: productId }, { appleProductId: productId }],
      })
      .exec();
    if (!pkg) {
      this.logger.warn(
        `RC webhook ${event.id}: no active RechargePackage matches product_id=${productId}`,
      );
      return { status: 'unknown_product', detail: productId };
    }

    // ---- 5. Credit the wallet ----
    // Two transactions, same correlationId, so the ledger shows the
    // recharge and bonus side-by-side and a refund flow can reverse
    // them together. Each gets its own idempotency key derived from
    // the RC event id so a re-delivery of the webhook is a no-op.
    const correlationId = `revenuecat:${event.id}`;
    const baseKey = `revenuecat:${event.id}:base`;
    const bonusKey = `revenuecat:${event.id}:bonus`;

    // `wallet.credit()` is idempotent on its key — a re-delivered
    // webhook will return the existing transaction without crediting
    // again. Issue both calls regardless; if the base was already
    // applied, the bonus row will already exist too (we either
    // succeeded or failed both, since the wrapper above this method
    // doesn't crash mid-event).
    await this.wallets.credit(Currency.COINS, {
      userId,
      amount: pkg.coins,
      type: TxnType.RECHARGE,
      idempotencyKey: baseKey,
      correlationId,
      description: `Recharge — ${pkg.coins} coins (RC ${event.transaction_id ?? event.id})`,
      refType: 'revenuecat',
      // refId not set: event.id is a string, not a Mongo ObjectId, and
      // we already capture it in idempotencyKey + description.
    });

    if (pkg.bonusCoins > 0) {
      await this.wallets.credit(Currency.COINS, {
        userId,
        amount: pkg.bonusCoins,
        type: TxnType.RECHARGE_BONUS,
        idempotencyKey: bonusKey,
        correlationId,
        description: `Recharge bonus — ${pkg.bonusCoins} coins`,
        refType: 'revenuecat',
      });
    }

    this.logger.log(
      `RC ${event.type} processed: user=${userId} pkg=${pkg._id} ` +
        `coins=${pkg.coins}+${pkg.bonusCoins} key=${event.id}`,
    );

    return {
      status: 'credited',
      detail: `pkg=${pkg._id} coins=${pkg.coins}+${pkg.bonusCoins}`,
    };
  }
}
