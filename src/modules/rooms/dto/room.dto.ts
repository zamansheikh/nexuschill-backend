import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import {
  ChatPolicy,
  MicPolicy,
  RoomKind,
  RoomVideoMode,
} from '../schemas/room.schema';

export class CreateRoomDto {
  /// Optional. When omitted, the service falls back to the user's
  /// displayName / username so first-time creators get a sensible default.
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  announcement?: string;

  @IsOptional()
  @IsEnum(RoomKind)
  kind?: RoomKind;

  /** Required when `kind === video`. Ignored for audio rooms. */
  @IsOptional()
  @IsEnum(RoomVideoMode)
  videoMode?: RoomVideoMode;

  /**
   * Number of guest seats. Owner seat is always present at index 0.
   *   • audio: 4–15
   *   • video / hostBroadcast: fixed at 3 (the service overrides any
   *     value the client sends; included here so the create form can
   *     send a single shape regardless of kind)
   *   • video / multiSeat: 3 / 5 / 8 (4, 6, or 9 total seats)
   *
   * Per-kind legal values are enforced by [RoomsService] — the
   * decorator floor is relaxed to 3 to fit both video shapes.
   */
  @IsOptional()
  @IsInt()
  @Min(3)
  @Max(15)
  micCount?: number;
}

export class SetSeatVideoDto {
  /** True to start publishing video on this seat, false to stop. */
  @IsBoolean()
  on!: boolean;
}

export class UpdateRoomPoliciesDto {
  @IsOptional()
  @IsEnum(ChatPolicy)
  chat?: ChatPolicy;

  @IsOptional()
  @IsEnum(MicPolicy)
  mic?: MicPolicy;

  @IsOptional()
  @IsBoolean()
  superMic?: boolean;
}

export class UpdateRoomSettingsDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  announcement?: string;

  @IsOptional()
  @IsInt()
  @Min(3)
  @Max(15)
  micCount?: number;

  /**
   * Numeric room PIN. Exactly 4 digits when set; empty string clears it.
   * Omitting the field entirely leaves the password unchanged. Stored
   * both as a bcrypt hash (for compare on enter) and a `select: false`
   * plaintext mirror so the owner can re-view it from settings.
   */
  @IsOptional()
  @IsString()
  @Matches(/^(|\d{4})$/, {
    message: 'password must be a 4-digit PIN, or empty to clear',
  })
  password?: string;

  /** Room cover picture URL. Empty string clears it (falls back to the
   *  owner's avatar on the client). The cover-upload endpoint sets this
   *  to the Cloudinary URL after the image upload completes. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  coverUrl?: string;

  /** Cosmetic ID (must be a ROOM_CARD owned + equipped by the user). */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  themeCosmeticId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateRoomPoliciesDto)
  policies?: UpdateRoomPoliciesDto;
}

export class EnterRoomDto {
  /** Required if the room has a password. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  password?: string;
}

export class KickFromRoomDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class RemoveRoomDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class SendChatDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  text!: string;
}
