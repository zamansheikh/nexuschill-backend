import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginEmailDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(72)
  password!: string;
}
