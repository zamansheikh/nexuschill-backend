import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import {
  RechargePackage,
  RechargePackageSchema,
} from '../wallet/schemas/recharge-package.schema';
import { WalletModule } from '../wallet/wallet.module';
import { RevenueCatController } from './revenuecat.controller';
import { RevenueCatService } from './revenuecat.service';

/**
 * Hosts the RevenueCat webhook listener.
 *
 * Imports:
 *   • WalletModule — for `WalletService.credit()` (atomic balance +
 *     ledger insert; idempotent on key).
 *   • RechargePackage schema — registered directly so we can map a
 *     store product id back to a package without going through the
 *     options service. Same direct-Mongoose pattern other modules
 *     (Honors, Search, Reports) use to avoid module cycles.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: RechargePackage.name, schema: RechargePackageSchema },
    ]),
    WalletModule,
  ],
  controllers: [RevenueCatController],
  providers: [RevenueCatService],
})
export class RevenueCatModule {}
