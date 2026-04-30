import { IsString, MinLength } from 'class-validator';

export class GoogleLoginDto {
  /** Google ID token issued to the mobile/web client. */
  @IsString()
  @MinLength(20)
  idToken!: string;
}
