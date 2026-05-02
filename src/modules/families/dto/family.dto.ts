import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

import { FamilyJoinMode, FamilyStatus } from '../schemas/family.schema';

/**
 * Mobile create-family payload. Mirrors the on-screen form:
 * cover (URL + Cloudinary public_id from a prior upload), name, optional
 * notification, join mode, level requirement.
 */
export class CreateFamilyDto {
  @IsString()
  @IsNotEmpty()
  @Length(1, 15)
  name!: string;

  @IsOptional()
  @IsString()
  coverUrl?: string;

  @IsOptional()
  @IsString()
  coverPublicId?: string;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  notification?: string;

  @IsOptional()
  @IsEnum(FamilyJoinMode)
  joinMode?: FamilyJoinMode;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(99)
  joinLevelRequirement?: number;
}

/**
 * Patch payload — leader / co-leaders edit family metadata. Service
 * enforces the once-per-30-days rule on `name` and `coverUrl`.
 */
export class UpdateFamilyDto {
  @IsOptional()
  @IsString()
  @Length(1, 15)
  name?: string;

  @IsOptional()
  @IsString()
  coverUrl?: string;

  @IsOptional()
  @IsString()
  coverPublicId?: string;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  notification?: string;

  @IsOptional()
  @IsEnum(FamilyJoinMode)
  joinMode?: FamilyJoinMode;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(99)
  joinLevelRequirement?: number;
}

/** Admin-only — freeze / unfreeze / force-disband. */
export class UpdateFamilyStatusDto {
  @IsEnum(FamilyStatus)
  status!: FamilyStatus;
}
