import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class VerifyOtpDto {
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'Phone must be in E.164 format',
  })
  phone!: string;

  @IsString()
  @Length(4, 8)
  @Matches(/^\d+$/, { message: 'OTP must be digits only' })
  otp!: string;

  @IsOptional()
  @IsString()
  @Length(3, 20)
  @Matches(/^[a-zA-Z0-9_]+$/)
  username?: string;
}
