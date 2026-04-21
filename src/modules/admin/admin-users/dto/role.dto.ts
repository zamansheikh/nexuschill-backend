import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateRoleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  @Matches(/^[a-z0-9_]+$/, { message: 'Role name must be lowercase alphanumeric/underscore' })
  name!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  displayName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  permissions!: string[];

  @IsOptional()
  @IsEnum(['agency', 'reseller'])
  scopeType?: 'agency' | 'reseller';

  @IsOptional()
  @IsInt()
  priority?: number;
}

export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  @Matches(/^[a-z0-9_]+$/)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[];

  @IsOptional()
  @IsEnum(['agency', 'reseller'])
  scopeType?: 'agency' | 'reseller';

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
