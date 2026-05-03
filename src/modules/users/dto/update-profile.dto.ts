import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import { UserGender } from '../schemas/user.schema';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  @Matches(/^[a-z0-9_]+$/, { message: 'username must be lowercase alphanumeric/underscore' })
  username?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  language?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  country?: string;

  /** Self-declared gender from the profile-completion form. Required
   *  before the home screen unlocks; optional here so the same DTO
   *  serves both the post-signup gate AND later profile edits where
   *  the user may only be changing one field. */
  @IsOptional()
  @IsEnum(UserGender)
  gender?: UserGender;

  /** ISO-8601 date string. Validated at the field level only — we
   *  don't enforce a minimum age in the DTO so the mobile picker can
   *  evolve its threshold without a server contract change. */
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;
}
