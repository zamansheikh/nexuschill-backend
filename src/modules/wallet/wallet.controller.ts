import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';

import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ExchangeDiamondsDto } from './dto/wallet-options.dto';
import { Currency, TxnDirection, TxnType } from './schemas/transaction.schema';
import { WalletOptionsService } from './wallet-options.service';
import { WalletService } from './wallet.service';

@Controller({ path: 'wallet', version: '1' })
export class WalletController {
  constructor(
    private readonly wallet: WalletService,
    private readonly options: WalletOptionsService,
  ) {}

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

  /** Active recharge packages — drives the wallet's "Recharge Options" grid. */
  @Get('recharge-packages')
  async rechargePackages() {
    const items = await this.options.listActivePackages();
    return { items };
  }

  /** Active diamond → coin exchange tiers. */
  @Get('exchange-options')
  async exchangeOptions() {
    const items = await this.options.listActiveExchangeOptions();
    return { items };
  }

  /**
   * Atomic diamond-to-coin exchange. Idempotent on `idempotencyKey`:
   * retries with the same key return the existing transaction pair
   * without spending again.
   */
  @HttpCode(HttpStatus.OK)
  @Post('exchange-diamonds')
  async exchangeDiamonds(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: ExchangeDiamondsDto,
  ) {
    const option = await this.options.getExchangeOptionOrThrow(dto.optionId);
    if (!option.active) {
      // Surface a stable error code so the mobile app can swap in fresh
      // tiers if an admin disables one mid-flight.
      const err = new Error('Exchange option is not active') as Error & {
        code?: string;
      };
      err.code = 'EXCHANGE_OPTION_INACTIVE';
      throw err;
    }
    const result = await this.wallet.convertDiamondsToCoins({
      userId: current.userId,
      diamondsRequired: option.diamondsRequired,
      coinsAwarded: option.coinsAwarded,
      idempotencyKey: dto.idempotencyKey,
    });
    return {
      wallet: result.wallet,
      diamondTxn: result.diamondTxn,
      coinTxn: result.coinTxn,
    };
  }
}
