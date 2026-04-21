import {
  IsEnum,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Promote an app user to a partner admin (agency / reseller).
 * Creates a linked AdminUser record. The app user's mobile-app login is unchanged.
 */
export class PromoteUserDto {
  @IsMongoId()
  roleId!: string;

  @IsOptional()
  @IsEnum(['agency', 'reseller'])
  scopeType?: 'agency' | 'reseller';

  @IsOptional()
  @IsMongoId()
  scopeId?: string;

  /** Admin-panel email (can differ from the user's app email). */
  @IsString()
  @MaxLength(254)
  adminEmail!: string;

  /** Admin-panel username (lowercase, 3–30 chars). */
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  @Matches(/^[a-z0-9_]+$/)
  adminUsername!: string;

  /** Initial password for the admin account. User must change on first login. */
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  initialPassword!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayName?: string;
}
