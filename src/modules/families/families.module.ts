import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AdminAuthModule } from '../admin/admin-auth/admin-auth.module';
import { SvipModule } from '../svip/svip.module';
import { SystemConfigModule } from '../system-config/system-config.module';
import { WalletModule } from '../wallet/wallet.module';
import { AdminFamiliesController } from './admin-families.controller';
import { FamiliesController } from './families.controller';
import { FamiliesCron } from './families.cron';
import { FamiliesService } from './families.service';
import {
  FamilyMember,
  FamilyMemberSchema,
} from './schemas/family-member.schema';
import { Family, FamilySchema } from './schemas/family.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Family.name, schema: FamilySchema },
      { name: FamilyMember.name, schema: FamilyMemberSchema },
    ]),
    SvipModule, // exposes SvipService for the SVIP4 free-creation gate
    WalletModule, // exposes WalletService for the 6M-coin debit
    SystemConfigModule, // exposes feature toggle for `familiesEnabled`
    AdminAuthModule, // for admin-side guards on AdminFamiliesController
  ],
  controllers: [FamiliesController, AdminFamiliesController],
  providers: [FamiliesService, FamiliesCron],
  exports: [FamiliesService],
})
export class FamiliesModule {}
