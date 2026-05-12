import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import { AgencyMemberRole } from '../schemas/agency-member.schema';

export class JoinRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}

export class DecideRequestDto {
  @IsEnum(['approve', 'reject'])
  decision!: 'approve' | 'reject';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class SetMemberRoleDto {
  @IsEnum(AgencyMemberRole)
  role!: AgencyMemberRole;
}

/**
 * Simplified create-request payload. Mobile form collects only the
 * agency name + country, a logo, plus the applicant's KYC trio
 * (phone, address, ID card front, ID card back). Everything else
 * (code, description, pitch, contact email/phone) is derived or
 * skipped — the admin can fill in finer fields after approval.
 */
export class SubmitCreateRequestDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  country?: string;

  /** Agency avatar (Cloudinary URL from the upload endpoint). */
  @IsString()
  @MaxLength(500)
  logoUrl!: string;

  // ---- Applicant personal info (mandatory KYC for review) ----

  @IsString()
  @MaxLength(40)
  applicantPhone!: string;

  @IsString()
  @MaxLength(500)
  applicantAddress!: string;

  /** Photo of the applicant's government ID — front side. Required. */
  @IsString()
  @MaxLength(500)
  idCardFrontUrl!: string;

  /** Photo of the applicant's government ID — back side. Required. */
  @IsString()
  @MaxLength(500)
  idCardBackUrl!: string;
}

export class CreateMyAgencyDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(20)
  @Matches(/^[A-Z0-9_-]+$/i, {
    message: 'code must be alphanumeric (also _ and -)',
  })
  code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  country?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  contactPhone?: string;
}
