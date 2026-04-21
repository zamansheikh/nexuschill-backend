import { IsString, MaxLength, MinLength } from 'class-validator';

export class AdminLoginDto {
  /** Email or username */
  @IsString()
  @MinLength(3)
  @MaxLength(254)
  identifier!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(72)
  password!: string;
}

export class AdminRefreshDto {
  @IsString()
  @MinLength(10)
  refreshToken!: string;
}
