import {
  IsEmail,
  IsEnum,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateAdminDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(30)
  @Matches(/^[a-zA-Z0-9_]+$/)
  username!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayName?: string;

  @IsMongoId()
  roleId!: string;

  @IsOptional()
  @IsEnum(['agency', 'reseller'])
  scopeType?: 'agency' | 'reseller';

  @IsOptional()
  @IsMongoId()
  scopeId?: string;
}
