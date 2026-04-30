import { Controller, Get, Query } from '@nestjs/common';

import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Currency, TxnDirection, TxnType } from './schemas/transaction.schema';
import { WalletService } from './wallet.service';

@Controller({ path: 'wallet', version: '1' })
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  /** Current user's wallet (lazy-created if missing). */
  @Get('me')
  async myWallet(@CurrentUser() current: AuthenticatedUser) {
    const wallet = await this.wallet.getOrCreate(current.userId);
    return { wallet };
  }

  /** Current user's transaction history. */
  @Get('me/transactions')
  async myTransactions(
    @CurrentUser() current: AuthenticatedUser,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('currency') currency?: Currency,
    @Query('type') type?: TxnType,
    @Query('direction') direction?: TxnDirection,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.wallet.listTransactions({
      userId: current.userId,
      page,
      limit,
      currency,
      type,
      direction,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
  }
}
