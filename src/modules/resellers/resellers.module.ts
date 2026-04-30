import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AdminAuthModule } from '../admin/admin-auth/admin-auth.module';
import { Transaction, TransactionSchema } from '../wallet/schemas/transaction.schema';
import { Wallet, WalletSchema } from '../wallet/schemas/wallet.schema';
import { ResellersController } from './resellers.controller';
import { ResellersService } from './resellers.service';
import { Reseller, ResellerSchema } from './schemas/reseller.schema';
import {
  ResellerLedger,
  ResellerLedgerSchema,
} from './schemas/reseller-ledger.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Reseller.name, schema: ResellerSchema },
      { name: ResellerLedger.name, schema: ResellerLedgerSchema },
      // Reseller assignToUser writes directly to wallets/transactions in a
      // MongoDB session, so we register those models here as well.
      { name: Wallet.name, schema: WalletSchema },
      { name: Transaction.name, schema: TransactionSchema },
    ]),
    AdminAuthModule,
  ],
  controllers: [ResellersController],
  providers: [ResellersService],
  exports: [ResellersService],
})
export class ResellersModule {}
