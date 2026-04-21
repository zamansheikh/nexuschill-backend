import { IsEnum, IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';

import { AdminStatus } from '../schemas/admin-user.schema';

export class UpdateAdminDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  avatarUrl?: string;

  @IsOptional()
  @IsEnum(AdminStatus)
  status?: AdminStatus;

  @IsOptional()
  @IsMongoId()
  roleId?: string;

  @IsOptional()
  @IsMongoId()
  scopeId?: string;
}

export class ResetAdminPasswordDto {
  @IsString()
  @MaxLength(72)
  newPassword!: string;
}
