import { IsString, Matches } from 'class-validator';

export class SendOtpDto {
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'Phone must be in E.164 format, e.g. +8801700000000',
  })
  phone!: string;
}
