import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, FilterQuery, Model, Types } from 'mongoose';

import { AuthenticatedAdmin } from '../admin/admin-auth/strategies/admin-jwt.strategy';
import { NumericIdService } from '../common/numeric-id.service';
import { CounterScope } from '../common/schemas/counter.schema';
import {
  Currency,
  Transaction,
  TransactionDocument,
  TxnDirection,
  TxnStatus,
  TxnType,
} from '../wallet/schemas/transaction.schema';
import { Wallet, WalletDocument } from '../wallet/schemas/wallet.schema';
import { Reseller, ResellerDocument, ResellerStatus } from './schemas/reseller.schema';
import {
  ResellerLedger,
  ResellerLedgerDocument,
  ResellerLedgerType,
} from './schemas/reseller-ledger.schema';

interface ListResellersParams {
  page?: number;
  limit?: number;
  status?: ResellerStatus;
  country?: string;
  search?: string;
}

@Injectable()
export class ResellersService {
  constructor(
    @InjectModel(Reseller.name) private readonly resellerModel: Model<ResellerDocument>,
    @InjectModel(ResellerLedger.name)
    private readonly ledgerModel: Model<ResellerLedgerDocument>,
    @InjectModel(Wallet.name) private readonly walletModel: Model<WalletDocument>,
    @InjectModel(Transaction.name) private readonly txnModel: Model<TransactionDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly numericIds: NumericIdService,
  ) {}

  // ----------- Scope filtering (mirrors AgenciesService) -----------

  private scopeFilter(admin: AuthenticatedAdmin): FilterQuery<ResellerDocument> {
    if (admin.scopeType === 'reseller' && admin.scopeId) {
      return { _id: new Types.ObjectId(admin.scopeId) };
    }
    return {};
  }

  private async findOneOr404(
    id: string,
    admin: AuthenticatedAdmin,
  ): Promise<ResellerDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Reseller not found');
    }
    if (admin.scopeType === 'reseller' && admin.scopeId && admin.scopeId !== id) {
      throw new NotFoundException('Reseller not found');
    }
    const reseller = await this.resellerModel.findById(id).exec();
    if (!reseller) throw new NotFoundException('Reseller not found');
    return reseller;
  }

  async exists(id: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false;
    return (await this.resellerModel.countDocuments({ _id: id }).exec()) > 0;
  }

  // ----------- CRUD -----------

  async list(params: ListResellersParams, admin: AuthenticatedAdmin) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 20));
    const skip = (page - 1) * limit;

    const filter: FilterQuery<ResellerDocument> = { ...this.scopeFilter(admin) };
    if (params.status) filter.status = params.status;
    if (params.country) filter.country = params.country.toUpperCase();
    if (params.search) {
      const escaped = params.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      const or: FilterQuery<ResellerDocument>[] = [{ name: regex }, { code: regex }];
      if (/^\d{1,7}$/.test(params.search.trim())) {
        or.push({ numericId: parseInt(params.search.trim(), 10) });
      }
      filter.$or = or;
    }

    const [items, total] = await Promise.all([
      this.resellerModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.resellerModel.countDocuments(filter).exec(),
    ]);
    return { items, page, limit, total };
  }

  async findById(id: string, admin: AuthenticatedAdmin): Promise<ResellerDocument> {
    return this.findOneOr404(id, admin);
  }

  async create(input: any): Promise<ResellerDocument> {
    const codeUpper = input.code.toUpperCase();
    const exists = await this.resellerModel.countDocuments({ code: codeUpper }).exec();
    if (exists) {
      throw new ConflictException({
        code: 'RESELLER_CODE_TAKEN',
        message: `Reseller code "${codeUpper}" already in use`,
      });
    }
    return this.numericIds.createWithId(CounterScope.RESELLER, (numericId) =>
      this.resellerModel.create({
        ...input,
        numericId,
        code: codeUpper,
        country: (input.country ?? 'BD').toUpperCase(),
        status: ResellerStatus.ACTIVE,
        coinPool: 0,
        lifetimeCoinsReceived: 0,
        lifetimeCoinsAssigned: 0,
        createdBy:
          input.createdBy && Types.ObjectId.isValid(input.createdBy)
            ? new Types.ObjectId(input.createdBy)
            : null,
      }),
    );
  }

  async update(
    id: string,
    update: any,
    admin: AuthenticatedAdmin,
  ): Promise<ResellerDocument> {
    const reseller = await this.findOneOr404(id, admin);
    if (update.name !== undefined) reseller.name = update.name;
    if (update.description !== undefined) reseller.description = update.description;
    if (update.country !== undefined) reseller.country = update.country.toUpperCase();
    if (update.contactEmail !== undefined) reseller.contactEmail = update.contactEmail;
    if (update.contactPhone !== undefined) reseller.contactPhone = update.contactPhone;
    if (update.creditLimit !== undefined) reseller.creditLimit = update.creditLimit;
    if (update.commissionRate !== undefined) reseller.commissionRate = update.commissionRate;
    await reseller.save();
    return reseller;
  }

  async updateStatus(
    id: string,
    status: ResellerStatus,
    admin: AuthenticatedAdmin,
  ): Promise<ResellerDocument> {
    if (admin.scopeType === 'reseller') {
      throw new ForbiddenException({
        code: 'SCOPED_CANNOT_CHANGE_STATUS',
        message: 'Reseller admins cannot change their own status',
      });
    }
    const reseller = await this.findOneOr404(id, admin);
    reseller.status = status;
    await reseller.save();
    return reseller;
  }

  // ----------- Pool top-up (admin → reseller) -----------

  /**
   * Admin mints coins into a reseller's pool. Idempotent on `idempotencyKey`.
   * Atomic: either pool grows AND ledger entry exists, or nothing changes.
   */
  async topupPool(
    resellerId: string,
    amount: number,
    reason: string,
    performedBy: string,
    idempotencyKey: string,
    admin: AuthenticatedAdmin,
  ): Promise<{ reseller: ResellerDocument; ledger: ResellerLedgerDocument }> {
    if (amount <= 0) {
      throw new BadRequestException({ code: 'INVALID_AMOUNT', message: 'Amount must be > 0' });
    }
    if (!reason || reason.trim().length < 3) {
      throw new BadRequestException({ code: 'REASON_REQUIRED', message: 'A reason is required' });
    }

    const existing = await this.ledgerModel.findOne({ idempotencyKey }).exec();
    if (existing) {
      const reseller = await this.findOneOr404(resellerId, admin);
      return { reseller, ledger: existing };
    }

    const reseller = await this.findOneOr404(resellerId, admin);
    if (reseller.status !== ResellerStatus.ACTIVE) {
      throw new BadRequestException({
        code: 'RESELLER_NOT_ACTIVE',
        message: 'Cannot top up a non-active reseller',
      });
    }

    if (reseller.creditLimit > 0 && reseller.coinPool + amount > reseller.creditLimit) {
      throw new BadRequestException({
        code: 'CREDIT_LIMIT_EXCEEDED',
        message: 'This top-up would exceed the reseller credit limit',
        details: {
          currentPool: reseller.coinPool,
          creditLimit: reseller.creditLimit,
          attempting: amount,
        },
      });
    }

    const updated = await this.resellerModel
      .findOneAndUpdate(
        { _id: reseller._id, status: ResellerStatus.ACTIVE },
        { $inc: { coinPool: amount, lifetimeCoinsReceived: amount } },
        { new: true },
      )
      .exec();
    if (!updated) {
      throw new BadRequestException({ code: 'RESELLER_NOT_ACTIVE', message: 'State changed' });
    }

    let ledger: ResellerLedgerDocument;
    try {
      ledger = await this.ledgerModel.create({
        idempotencyKey,
        resellerId: updated._id,
        direction: 'credit',
        amount,
        type: ResellerLedgerType.POOL_TOPUP,
        reason,
        poolBalanceAfter: updated.coinPool,
        performedBy: new Types.ObjectId(performedBy),
      });
    } catch (err: any) {
      // Concurrent retry slipped through — reverse our $inc and return existing.
      if (err?.code === 11000) {
        await this.resellerModel
          .updateOne(
            { _id: updated._id },
            { $inc: { coinPool: -amount, lifetimeCoinsReceived: -amount } },
          )
          .exec();
        ledger = (await this.ledgerModel.findOne({ idempotencyKey }).exec())!;
      } else {
        throw err;
      }
    }

    const fresh = await this.resellerModel.findById(updated._id).exec();
    return { reseller: fresh!, ledger };
  }

  // ----------- Assign coins to a user (reseller → user) -----------

  /**
   * Atomic transaction: drain reseller pool, credit user wallet, write both
   * ledgers (reseller-side + user-side). Idempotent on `idempotencyKey`.
   */
  async assignToUser(
    resellerId: string,
    userId: string,
    amount: number,
    reason: string,
    performedBy: string,
    idempotencyKey: string,
    admin: AuthenticatedAdmin,
  ): Promise<{ reseller: ResellerDocument; userTxnId: string; userWalletCoins: number }> {
    if (amount <= 0) {
      throw new BadRequestException({ code: 'INVALID_AMOUNT', message: 'Amount must be > 0' });
    }
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException({ code: 'INVALID_USER_ID', message: 'Invalid user id' });
    }

    const existing = await this.ledgerModel.findOne({ idempotencyKey }).exec();
    if (existing) {
      const reseller = await this.findOneOr404(resellerId, admin);
      const txn = existing.userTxnId
        ? await this.txnModel.findById(existing.userTxnId).exec()
        : null;
      const wallet = await this.walletModel
        .findOne({ userId: new Types.ObjectId(userId) })
        .exec();
      return {
        reseller,
        userTxnId: existing.userTxnId?.toString() ?? '',
        userWalletCoins: wallet?.coins ?? txn?.balanceAfter ?? 0,
      };
    }

    // Resolve & scope-check
    const reseller = await this.findOneOr404(resellerId, admin);
    if (reseller.status !== ResellerStatus.ACTIVE) {
      throw new BadRequestException({
        code: 'RESELLER_NOT_ACTIVE',
        message: 'Reseller is not active',
      });
    }

    const session = await this.connection.startSession();
    try {
      let userTxnId: Types.ObjectId | null = null;
      let updatedReseller!: ResellerDocument;
      let userWalletCoins = 0;

      await session.withTransaction(async () => {
        // 1. Drain reseller pool (atomic).
        const drained = await this.resellerModel.findOneAndUpdate(
          {
            _id: reseller._id,
            status: ResellerStatus.ACTIVE,
            coinPool: { $gte: amount },
          },
          { $inc: { coinPool: -amount, lifetimeCoinsAssigned: amount } },
          { session, new: true },
        );
        if (!drained) {
          throw new BadRequestException({
            code: 'INSUFFICIENT_POOL',
            message: 'Reseller pool has insufficient coins',
            details: { requested: amount, available: reseller.coinPool },
          });
        }
        updatedReseller = drained;

        // 2. Credit user wallet (atomic, with frozen check).
        const userObj = new Types.ObjectId(userId);
        const userWallet = await this.walletModel.findOneAndUpdate(
          { userId: userObj, frozen: false },
          {
            $inc: { coins: amount, lifetimeCoinsRecharged: amount },
            $setOnInsert: { userId: userObj },
          },
          { session, new: true, upsert: true },
        );
        if (!userWallet) {
          throw new ForbiddenException({
            code: 'WALLET_FROZEN',
            message: 'Recipient wallet is frozen',
          });
        }
        userWalletCoins = userWallet.coins;

        // 3. Wallet ledger entry (user-side).
        const userTxn = await this.txnModel.create(
          [
            {
              idempotencyKey: `${idempotencyKey}:user`,
              correlationId: idempotencyKey,
              walletId: userWallet._id,
              userId: userObj,
              currency: Currency.COINS,
              direction: TxnDirection.CREDIT,
              amount,
              type: TxnType.RESELLER_TOPUP,
              description: `Reseller ${reseller.code}: ${reason || 'coin assignment'}`,
              refType: 'reseller',
              refId: reseller._id,
              balanceAfter: userWallet.coins,
              performedBy:
                performedBy && Types.ObjectId.isValid(performedBy)
                  ? new Types.ObjectId(performedBy)
                  : null,
              status: TxnStatus.COMPLETED,
            },
          ],
          { session },
        );
        userTxnId = userTxn[0]._id;

        // 4. Reseller ledger entry (pool-side).
        await this.ledgerModel.create(
          [
            {
              idempotencyKey,
              resellerId: drained._id,
              direction: 'debit',
              amount,
              type: ResellerLedgerType.ASSIGNMENT,
              reason: reason || 'coin assignment',
              poolBalanceAfter: drained.coinPool,
              performedBy: new Types.ObjectId(performedBy),
              recipientUserId: userObj,
              userTxnId,
            },
          ],
          { session },
        );
      });

      return {
        reseller: updatedReseller,
        userTxnId: userTxnId ? (userTxnId as Types.ObjectId).toString() : '',
        userWalletCoins,
      };
    } finally {
      await session.endSession();
    }
  }

  // ----------- Ledger read -----------

  async listLedger(
    resellerId: string,
    admin: AuthenticatedAdmin,
    params: { page?: number; limit?: number; type?: ResellerLedgerType },
  ) {
    await this.findOneOr404(resellerId, admin); // scope check
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 50));
    const skip = (page - 1) * limit;

    const filter: FilterQuery<ResellerLedgerDocument> = {
      resellerId: new Types.ObjectId(resellerId),
    };
    if (params.type) filter.type = params.type;

    const [items, total] = await Promise.all([
      this.ledgerModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('recipientUserId', 'username displayName')
        .populate('performedBy', 'username displayName')
        .exec(),
      this.ledgerModel.countDocuments(filter).exec(),
    ]);
    return { items, page, limit, total };
  }
}
