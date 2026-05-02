/**
 * System permissions catalog.
 *
 * Format: `resource.action`
 * Wildcards supported at role level:
 *   '*'          → all permissions
 *   'users.*'    → all actions on users
 *   'users.ban'  → exact permission
 *
 * Add new permissions here as new features are built.
 */

export const PERMISSIONS = {
  ALL: '*',

  // Admin management (super_admin territory)
  ADMIN_VIEW: 'admin.view',
  ADMIN_CREATE: 'admin.create',
  ADMIN_UPDATE: 'admin.update',
  ADMIN_DELETE: 'admin.delete',
  ADMIN_ROLE_MANAGE: 'admin.role.manage',

  // App users
  USERS_VIEW: 'users.view',
  USERS_EDIT: 'users.edit',
  USERS_BAN: 'users.ban',
  USERS_BALANCE: 'users.balance',
  USERS_DELETE: 'users.delete',

  // Hosts / broadcasters
  HOSTS_VIEW: 'hosts.view',
  HOSTS_APPROVE: 'hosts.approve',
  HOSTS_REVOKE: 'hosts.revoke',
  HOSTS_ASSIGN_AGENCY: 'hosts.assign_agency',

  // Rooms / live content
  ROOMS_VIEW: 'rooms.view',
  ROOMS_MONITOR: 'rooms.monitor',
  ROOMS_CLOSE: 'rooms.close',

  // Gifts
  GIFTS_VIEW: 'gifts.view',
  GIFTS_MANAGE: 'gifts.manage',

  // Recharge
  RECHARGE_VIEW: 'recharge.view',
  RECHARGE_REFUND: 'recharge.refund',
  RECHARGE_PACKAGE_MANAGE: 'recharge.package.manage',

  // Withdrawal
  WITHDRAWAL_VIEW: 'withdrawal.view',
  WITHDRAWAL_APPROVE: 'withdrawal.approve',
  WITHDRAWAL_REJECT: 'withdrawal.reject',

  // Wallets & ledger
  WALLET_VIEW: 'wallet.view',
  WALLET_ADJUST: 'wallet.adjust',
  WALLET_FREEZE: 'wallet.freeze',
  /** Permission to mint new coins (admin generates supply, no payment gateway). */
  WALLET_MINT: 'wallet.mint',
  TRANSACTIONS_VIEW: 'transactions.view',

  // Agency
  AGENCY_VIEW: 'agency.view',
  AGENCY_MANAGE: 'agency.manage',
  AGENCY_ASSIGN_HOST: 'agency.assign_host',

  // Reseller
  RESELLER_VIEW: 'reseller.view',
  RESELLER_MANAGE: 'reseller.manage',
  RESELLER_DISTRIBUTE_COINS: 'reseller.distribute_coins',

  // Moderation
  MODERATION_VIEW: 'moderation.view',
  MODERATION_ACTION: 'moderation.action',
  MODERATION_APPEALS: 'moderation.appeals',

  // Store
  STORE_VIEW: 'store.view',
  STORE_MANAGE: 'store.manage',

  // VIP / SVIP
  VIP_VIEW: 'vip.view',
  VIP_MANAGE: 'vip.manage',

  // Cosmetics catalog (frames, vehicles, themes, badges, chat bubbles, …)
  // Used as the underlying inventory for both SVIP grants and the store.
  COSMETICS_VIEW: 'cosmetics.view',
  COSMETICS_MANAGE: 'cosmetics.manage',

  // Banners — home-screen carousel + custom splash banners.
  BANNERS_VIEW: 'banners.view',
  BANNERS_MANAGE: 'banners.manage',

  // Push notifications — fan a custom notification + FCM push to
  // all users / a specific user / a list of users.
  NOTIFICATIONS_PUSH: 'notifications.push',

  // Daily reward (7-day check-in cycle config).
  DAILY_REWARD_VIEW: 'daily_reward.view',
  DAILY_REWARD_MANAGE: 'daily_reward.manage',

  // Magic Ball — host daily-task config.
  MAGIC_BALL_VIEW: 'magic_ball.view',
  MAGIC_BALL_MANAGE: 'magic_ball.manage',

  // Agora — RTC/RTM credentials. View shows masked certificate; manage
  // can rotate keys. Token-mint endpoints are user-side and don't need
  // an admin permission.
  AGORA_VIEW: 'agora.view',
  AGORA_MANAGE: 'agora.manage',

  // Moments — social feed posts. View = list/inspect, moderate = remove/
  // restore. Authors can always delete their own post via the user API.
  MOMENTS_VIEW: 'moments.view',
  MOMENTS_MODERATE: 'moments.moderate',


  // Families
  FAMILY_VIEW: 'family.view',
  FAMILY_MANAGE: 'family.manage',

  // Reports & analytics
  REPORTS_VIEW: 'reports.view',
  REPORTS_EXPORT: 'reports.export',

  // System
  SYSTEM_CONFIG: 'system.config',
  SYSTEM_AUDIT_LOG: 'system.audit_log',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/**
 * Check if a set of granted permissions satisfies a required permission.
 * Supports '*' (all) and prefix wildcard (e.g. 'users.*').
 */
export function hasPermission(granted: string[], required: string): boolean {
  if (granted.includes('*')) return true;
  if (granted.includes(required)) return true;

  const parts = required.split('.');
  for (let i = parts.length - 1; i > 0; i--) {
    const wildcard = parts.slice(0, i).join('.') + '.*';
    if (granted.includes(wildcard)) return true;
  }
  return false;
}

/**
 * Default system roles — created on first boot, cannot be deleted.
 * Permissions can still be edited by a super_admin.
 */
export const DEFAULT_ROLES = [
  {
    name: 'super_admin',
    displayName: 'Super Admin',
    description: 'Full platform access. Cannot be deleted.',
    permissions: [PERMISSIONS.ALL],
    isSystem: true,
    priority: 100,
  },
  {
    name: 'admin',
    displayName: 'Admin',
    description: 'General platform admin — most actions except admin/role management.',
    permissions: [
      'users.*',
      'hosts.*',
      'rooms.*',
      'gifts.*',
      'recharge.view',
      'recharge.refund',
      'withdrawal.*',
      'moderation.*',
      'store.*',
      'vip.*',
      'cosmetics.*',
      'banners.*',
      'daily_reward.*',
      'magic_ball.*',
      'agora.*',
      'moments.*',
      'family.*',
      'agency.*',
      'reseller.view',
      'wallet.*',
      'transactions.view',
      'reports.*',
    ],
    isSystem: true,
    priority: 80,
  },
  {
    name: 'moderator',
    displayName: 'Moderator',
    description: 'Handles content moderation and user reports.',
    permissions: [
      'users.view',
      'users.ban',
      'rooms.view',
      'rooms.monitor',
      'rooms.close',
      'moderation.*',
    ],
    isSystem: true,
    priority: 60,
  },
  {
    name: 'finance',
    displayName: 'Finance',
    description: 'Recharge, withdrawal, and financial reports.',
    permissions: [
      'recharge.*',
      'withdrawal.*',
      'wallet.*',
      'transactions.view',
      'reports.*',
      'users.view',
    ],
    isSystem: true,
    priority: 70,
  },
  {
    name: 'support',
    displayName: 'Support Agent',
    description: 'Customer support — read-only plus limited user edits.',
    permissions: [
      'users.view',
      'users.edit',
      'recharge.view',
      'withdrawal.view',
      'moderation.view',
      'wallet.view',
      'transactions.view',
    ],
    isSystem: true,
    priority: 40,
  },
  {
    name: 'agency',
    displayName: 'Agency Manager',
    description: 'Manages hosts assigned to their agency only (scope-restricted).',
    permissions: [
      'hosts.view',
      'hosts.assign_agency',
      'agency.view',
      'reports.view',
    ],
    isSystem: true,
    scopeType: 'agency' as const,
    priority: 50,
  },
  {
    name: 'reseller',
    displayName: 'Reseller',
    description: 'Distributes coins to their assigned users (scope-restricted).',
    permissions: [
      'users.view',
      'recharge.view',
      'reseller.view',
      'reseller.distribute_coins',
    ],
    isSystem: true,
    scopeType: 'reseller' as const,
    priority: 30,
  },
];
