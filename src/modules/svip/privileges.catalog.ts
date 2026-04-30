/**
 * SVIP privileges catalog. Each privilege is a string flag stored on
 * `SvipTier.privileges`. Other features check whether the user's current
 * tier grants a privilege to gate behavior (e.g. chat module checks
 * `cant_be_ban_public_chat` before allowing a moderator to ban).
 *
 * Adding a new privilege here is harmless on its own — it'll show up in the
 * admin tier editor as an available flag. Enforcement lives in the feature
 * that consumes it.
 */
export interface PrivilegeDef {
  key: string;
  /** UI label (English). Bangla is added in the i18n table later. */
  label: string;
  /** One-liner shown in admin tier editor as a hint. */
  description: string;
  /** Grouping in the admin UI. */
  category: 'visibility' | 'chat' | 'profile' | 'gameplay' | 'identity' | 'protection';
}

export const SVIP_PRIVILEGES: readonly PrivilegeDef[] = [
  // Visibility / discovery
  { key: 'view_visitor_records', label: 'View visitor records', description: 'See who viewed your profile.', category: 'visibility' },
  { key: 'hide_visit_records', label: 'Hide visit records', description: 'Browse other profiles invisibly.', category: 'visibility' },
  { key: 'hide_online_status', label: 'Hide online status', description: 'Appear offline.', category: 'visibility' },
  { key: 'room_online_list_on_top', label: 'Room online list on top', description: 'Float to the top of the in-room user list.', category: 'visibility' },

  // Identity / cosmetics-adjacent
  { key: 'golden_name', label: 'Golden name', description: 'Username displays in gold.', category: 'identity' },
  { key: 'special_colorful_name', label: 'Special colorful name', description: 'Animated rainbow username.', category: 'identity' },
  { key: 'svip_emoji', label: 'SVIP emoji', description: 'Unlock SVIP emoji set in chat.', category: 'identity' },
  { key: 'svip_gifts', label: 'SVIP gifts', description: 'Send SVIP-only gifts.', category: 'identity' },
  { key: 'special_id_5_digit', label: '5-digit special ID', description: 'Claim a 5-digit numericId.', category: 'identity' },
  { key: 'special_id_6_digit', label: '6-digit special ID', description: 'Claim a 6-digit numericId.', category: 'identity' },
  { key: 'dynamic_avatar', label: 'Dynamic avatar', description: 'Use animated GIF/WebM as avatar.', category: 'identity' },

  // Profile customization
  { key: 'profile_background', label: 'Profile background', description: 'Set a single profile background.', category: 'profile' },
  { key: 'profile_background_multi', label: 'Multiple profile backgrounds', description: 'Rotate through multiple backgrounds.', category: 'profile' },
  { key: 'customized_theme', label: 'Customized theme', description: 'Custom UI theme on personal profile.', category: 'profile' },

  // Chat / messaging
  { key: 'send_room_pictures', label: 'Send room pictures', description: 'Attach images in room chat.', category: 'chat' },
  { key: 'send_message_pictures', label: 'Send message pictures', description: 'Attach images in DMs.', category: 'chat' },
  { key: 'avoid_disturbing', label: 'Avoid disturbing', description: 'Filter incoming messages from non-friends.', category: 'chat' },

  // Gameplay
  { key: 'ludo_dice_skin', label: 'Ludo dice skin', description: 'Equip cosmetic dice skins.', category: 'gameplay' },
  { key: 'ludo_dice_refresh', label: 'Ludo dice refresh', description: 'Reroll dice once per game.', category: 'gameplay' },
  { key: 'exp_boost_140', label: 'EXP × 140% speed up', description: 'Earn 40% more XP.', category: 'gameplay' },

  // Protection / moderation
  { key: 'cant_be_kicked', label: "Can't be kicked", description: 'Mods cannot kick this user from rooms.', category: 'protection' },
  { key: 'cant_be_ban_public_chat', label: "Can't be banned from public chat", description: 'Mods cannot mute this user.', category: 'protection' },
  { key: 'unban_account_3', label: 'Unban account ×3', description: 'Self-unban up to 3 times.', category: 'protection' },
  { key: 'ban_account', label: 'Ban account', description: 'Issue a community ban on another user.', category: 'protection' },
] as const;

export type PrivilegeKey = (typeof SVIP_PRIVILEGES)[number]['key'];
