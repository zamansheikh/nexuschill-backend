import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Request } from 'express';

import { AdminOnly } from '../admin/admin-auth/decorators/admin-only.decorator';
import { CurrentAdmin } from '../admin/admin-auth/decorators/current-admin.decorator';
import { RequirePermissions } from '../admin/admin-auth/decorators/require-permissions.decorator';
import { AuthenticatedAdmin } from '../admin/admin-auth/strategies/admin-jwt.strategy';
import { PERMISSIONS } from '../admin/permissions.catalog';
import { AdjustBalanceDto, FreezeWalletDto, MintCoinsDto } from './dto/adjust-balance.dto';
import { Currency, TxnDirection, TxnType } from './schemas/transaction.schema';
import { WalletService } from './wallet.service';

@Controller({ path: 'admin', version: '1' })
@AdminOnly()
export class AdminWalletController {
  constructor(private readonly wallet: WalletService) {}

  // ---------- Wallets ----------

  @RequirePermissions(PERMISSIONS.WALLET_VIEW)
  @Get('wallets')
  async listWallets(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('minCoins') minCoins?: number,
    @Query('minDiamonds') minDiamonds?: number,
  ) {
    return this.wallet.list({ page, limit, minCoins, minDiamonds });
  }

  @RequirePermissions(PERMISSIONS.WALLET_VIEW)
  @Get('wallets/:userId')
  async getOne(@Param('userId') userId: string) {
    const wallet = await this.wallet.getOrCreate(userId);
    return { wallet };
  }

  @RequirePermissions(PERMISSIONS.WALLET_MINT)
  @HttpCode(HttpStatus.OK)
  @Post('wallets/:userId/mint')
  async mint(
    @Param('userId') userId: string,
    @Body() dto: MintCoinsDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Req() req: Request,
  ) {
    if (!dto.reason || dto.reason.trim().length < 3) {
      throw new BadRequestException({
        code: 'REASON_REQUIRED',
        message: 'A reason is required when minting coins',
      });
    }
    const idemKey = dto.idempotencyKey || this.wallet.generateKey(`mint-${userId}`);
    const txn = await this.wallet.credit(Currency.COINS, {
      userId,
      amount: dto.amount,
      type: TxnType.MINT,
      description: dto.reason,
      idempotencyKey: idemKey,
      performedBy: admin.adminId,
      performedByIp: req.ip,
    });
    const wallet = await this.wallet.findByUserId(userId);
    return { transaction: txn, wallet };
  }

  @RequirePermissions(PERMISSIONS.WALLET_ADJUST)
  @HttpCode(HttpStatus.OK)
  @Post('wallets/:userId/adjust')
  async adjust(
    @Param('userId') userId: string,
    @Body() dto: AdjustBalanceDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Req() req: Request,
  ) {
    if (!dto.reason || dto.reason.trim().length < 3) {
      throw new BadRequestException({
        code: 'REASON_REQUIRED',
        message: 'A reason is required for manual balance adjustments',
      });
    }

    const idemKey = dto.idempotencyKey || this.wallet.generateKey(`admin-adjust-${userId}`);
    const type = dto.direction === TxnDirection.CREDIT ? TxnType.ADMIN_CREDIT : TxnType.ADMIN_DEBIT;

    const txn =
      dto.direction === TxnDirection.CREDIT
        ? await this.wallet.credit(dto.currency, {
            userId,
            amount: dto.amount,
            type,
            description: dto.reason,
            idempotencyKey: idemKey,
            performedBy: admin.adminId,
            performedByIp: req.ip,
          })
        : await this.wallet.debit(dto.currency, {
            userId,
            amount: dto.amount,
            type,
            description: dto.reason,
            idempotencyKey: idemKey,
            performedBy: admin.adminId,
            performedByIp: req.ip,
          });

    const wallet = await this.wallet.findByUserId(userId);
    return { transaction: txn, wallet };
  }

  @RequirePermissions(PERMISSIONS.WALLET_FREEZE)
  @HttpCode(HttpStatus.OK)
  @Post('wallets/:userId/freeze')
  async freeze(
    @Param('userId') userId: string,
    @Body() dto: FreezeWalletDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    const wallet = await this.wallet.freeze(userId, dto.reason, admin.adminId);
    return { wallet };
  }

  @RequirePermissions(PERMISSIONS.WALLET_FREEZE)
  @HttpCode(HttpStatus.OK)
  @Post('wallets/:userId/unfreeze')
  async unfreeze(@Param('userId') userId: string) {
    const wallet = await this.wallet.unfreeze(userId);
    return { wallet };
  }

  // ---------- Transactions explorer ----------

  @RequirePermissions(PERMISSIONS.TRANSACTIONS_VIEW)
  @Get('transactions')
  async listTransactions(
    @Query('userId') userId?: string,
    @Query('walletId') walletId?: string,
    @Query('currency') currency?: Currency,
    @Query('type') type?: TxnType,
    @Query('direction') direction?: TxnDirection,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.wallet.listTransactions({
      userId,
      walletId,
      currency,
      type,
      direction,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      page,
      limit,
    });
  }
}
