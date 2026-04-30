import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { ChatPolicy, MicPolicy, RoomKind } from '../schemas/room.schema';

export class CreateRoomDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  announcement?: string;

  @IsOptional()
  @IsEnum(RoomKind)
  kind?: RoomKind;

  /** Number of guest seats; owner seat is always present at index 0. */
  @IsOptional()
  @IsInt()
  @Min(4)
  @Max(15)
  micCount?: number;
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
  @Min(4)
  @Max(15)
  micCount?: number;

  /**
   * Empty string clears the password. Anything else is hashed and stored.
   * Omitting the field entirely leaves the password unchanged.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  password?: string;

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
