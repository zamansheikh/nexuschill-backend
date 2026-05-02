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
} from 'class-validator';

import { MagicBallTaskKind } from '../schemas/magic-ball-task.schema';

export class CreateMagicBallTaskDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  label!: string;

  @IsEnum(MagicBallTaskKind)
  kind!: MagicBallTaskKind;

  @IsInt()
  @Min(1)
  @Max(1_000_000)
  goal!: number;

  @IsInt()
  @Min(0)
  @Max(10_000_000)
  rewardCoins!: number;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateMagicBallTaskDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @IsOptional()
  @IsEnum(MagicBallTaskKind)
  kind?: MagicBallTaskKind;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  goal?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  rewardCoins?: number;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/** Mobile reports a finished mic session (seconds). Service rounds to whole minutes. */
export class TrackMicDto {
  @IsInt()
  @Min(0)
  @Max(24 * 60 * 60) // 24h ceiling — way beyond what any session would legitimately log
  seconds!: number;
}
