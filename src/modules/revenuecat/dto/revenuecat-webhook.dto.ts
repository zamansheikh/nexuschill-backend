/**
 * RevenueCat webhook payload — only the fields we actually consume.
 *
 * Full schema:
 *   https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields
 *
 * We deliberately type this as the minimal slice we read so a future
 * field addition by RC doesn't break the interface; everything else
 * is forwarded as-is into the audit log.
 */
export interface RevenueCatEvent {
  type:
    | 'INITIAL_PURCHASE'
    | 'RENEWAL'
    | 'NON_RENEWING_PURCHASE'
    | 'CANCELLATION'
    | 'EXPIRATION'
    | 'BILLING_ISSUE'
    | 'PRODUCT_CHANGE'
    | 'TRANSFER'
    | 'SUBSCRIBER_ALIAS'
    | 'SUBSCRIPTION_PAUSED'
    | 'TEST'
    | string;

  /** Stable id for the event itself — used as our idempotency key. */
  id: string;

  /** Store-side transaction id (Google order id, Apple transaction id). */
  transaction_id?: string;

  /**
   * Caller's app-user-id, set when the mobile app calls
   * `Purchases.logIn(userMongoId)` on sign-in. We resolve this back to
   * a User document; if it's missing or unknown, the webhook is dropped.
   */
  app_user_id?: string;

  /** Store SKU — must match the package's googleProductId or appleProductId. */
  product_id?: string;

  store?: 'PLAY_STORE' | 'APP_STORE' | 'AMAZON' | 'STRIPE' | 'PROMOTIONAL' | string;

  environment?: 'PRODUCTION' | 'SANDBOX' | string;

  /** Local price (just for analytics / audit notes — never authoritative). */
  price?: number;
  currency?: string;

  /** Milliseconds since epoch — RC standard timestamp shape. */
  purchased_at_ms?: number;
}

export interface RevenueCatWebhookDto {
  api_version?: string;
  event: RevenueCatEvent;
}
