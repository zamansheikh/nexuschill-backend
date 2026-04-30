import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, FilterQuery, Model, Types } from 'mongoose';
import { nanoid } from 'nanoid';

import { Wallet, WalletDocument } from './schemas/wallet.schema';
import {
  Currency,
  Transaction,
  TransactionDocument,
  TxnDirection,
  TxnStatus,
  TxnType,
} from './schemas/transaction.schema';

interface CreditDebitParams {
  userId: string;
  amount: number;
  type: TxnType;
  description?: string;
  idempotencyKey: string;
  refType?: string;
  refId?: string;
  performedBy?: string;
  performedByIp?: string;
}

interface ListTransactionsParams {
  userId?: string;
  walletId?: string;
  currency?: Currency;
  type?: TxnType;
  direction?: TxnDirection;
  from?: Date;
  to?: Date;
  page?: number;
  limit?: number;
}

interface GiftTransferParams {
  senderUserId: string;
  receiverUserId: string;
  coinAmount: number;
  beanReward: number;
  giftId?: string;
  idempotencyKey: string;
  description?: string;
}

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    @InjectModel(Wallet.name) private readonly walletModel: Model<WalletDocument>,
    @InjectModel(Transaction.name) private readonly txnModel: Model<TransactionDocument>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  // ----------- Wallet lookup / lazy create -----------

  /** Returns the wallet for a user, creating an empty one if missing. */
  async getOrCreate(userId: string): Promise<WalletDocument> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException({ code: 'INVALID_USER_ID', message: 'Invalid user id' });
    }
    const userObjId = new Types.ObjectId(userId);
    return this.walletModel
      .findOneAndUpdate(
        { userId: userObjId },
        { $setOnInsert: { userId: userObjId } },
        { new: true, upsert: true },
      )
      .exec();
  }

  async findByUserId(userId: string): Promise<WalletDocument | null> {
    if (!Types.ObjectId.isValid(userId)) return null;
    return this.walletModel.findOne({ userId: new Types.ObjectId(userId) }).exec();
  }

  async list(params: { page?: number; limit?: number; minCoins?: number; minBeans?: number }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 20));
    const skip = (page - 1) * limit;

    const filter: FilterQuery<WalletDocument> = {};
    if (params.minCoins !== undefined) filter.coins = { $gte: params.minCoins };
    if (params.minBeans !== undefined) filter.beans = { $gte: params.minBeans };

    const [items, total] = await Promise.all([
      this.walletModel.find(filter).sort({ coins: -1 }).skip(skip).limit(limit).exec(),
      this.walletModel.countDocuments(filter).exec(),
    ]);
    return { items, page, limit, total };
  }

  // ----------- Single-wallet credit / debit -----------

  /**
   * Atomic single-wallet credit. Idempotent on `idempotencyKey`.
   * If a transaction with the same key already exists, returns it without re-applying.
   */
  async credit(currency: Currency, p: CreditDebitParams): Promise<TransactionDocument> {
    return this.applyDelta(currency, TxnDirection.CREDIT, p);
  }

  /**
   * Atomic single-wallet debit. Throws InsufficientBalance if not enough funds.
   */
  async debit(currency: Currency, p: CreditDebitParams): Promise<TransactionDocument> {
    return this.applyDelta(currency, TxnDirection.DEBIT, p);
  }

  private async applyDelta(
    currency: Currency,
    direction: TxnDirection,
    p: CreditDebitParams,
  ): Promise<TransactionDocument> {
    if (p.amount <= 0) {
      throw new BadRequestException({ code: 'AMOUNT_NON_POSITIVE', message: 'Amount must be > 0' });
    }
    if (!Types.ObjectId.isValid(p.userId)) {
      throw new BadRequestException({ code: 'INVALID_USER_ID', message: 'Invalid user id' });
    }

    // 1. Idempotency check — if a txn already exists for this key, return it.
    const existing = await this.txnModel.findOne({ idempotencyKey: p.idempotencyKey }).exec();
    if (existing) return existing;

    // 2. Atomic wallet update with frozen + (for debit) sufficient-balance guard.
    const userObjId = new Types.ObjectId(p.userId);
    const isCredit = direction === TxnDirection.CREDIT;
    const balanceField = currency;
    const lifetimeField = this.lifetimeFieldFor(currency, direction, p.type);

    const updateFilter: FilterQuery<WalletDocument> = { userId: userObjId, frozen: false };
    if (!isCredit) {
      updateFilter[balanceField] = { $gte: p.amount };
    }

    const inc: Record<string, number> = {
      [balanceField]: isCredit ? p.amount : -p.amount,
    };
    if (lifetimeField) inc[lifetimeField] = p.amount;

    const updated = await this.walletModel
      .findOneAndUpdate(updateFilter, { $inc: inc, $setOnInsert: { userId: userObjId } }, {
        new: true,
        upsert: isCredit, // only allow upsert on credit (we shouldn't create wallet to debit it)
      })
      .exec();

    if (!updated) {
      // Either frozen, or insufficient balance. Distinguish.
      const wallet = await this.findByUserId(p.userId);
      if (wallet?.frozen) {
        throw new ForbiddenException({ code: 'WALLET_FROZEN', message: 'Wallet is frozen' });
      }
      throw new BadRequestException({
        code: 'INSUFFICIENT_BALANCE',
        message: `Not enough ${currency}`,
        details: {
          required: p.amount,
          available: wallet?.[balanceField] ?? 0,
        },
      });
    }

    // 3. Write ledger entry. Idempotency key uniqueness will catch concurrent retries.
    try {
      const txn = await this.txnModel.create({
        idempotencyKey: p.idempotencyKey,
        correlationId: p.idempotencyKey, // singletons re-use the key
        walletId: updated._id,
        userId: userObjId,
        currency,
        direction,
        amount: p.amount,
        type: p.type,
        description: p.description ?? '',
        refType: p.refType ?? null,
        refId: p.refId && Types.ObjectId.isValid(p.refId) ? new Types.ObjectId(p.refId) : null,
        balanceAfter: updated[balanceField],
        performedBy:
          p.performedBy && Types.ObjectId.isValid(p.performedBy)
            ? new Types.ObjectId(p.performedBy)
            : null,
        performedByIp: p.performedByIp ?? '',
        status: TxnStatus.COMPLETED,
      });
      return txn;
    } catch (err: any) {
      // Duplicate key (concurrent request slipped through). Reverse the wallet update and return existing.
      if (err?.code === 11000) {
        await this.walletModel
          .updateOne(
            { _id: updated._id },
            {
              $inc: {
                [balanceField]: isCredit ? -p.amount : p.amount,
                ...(lifetimeField ? { [lifetimeField]: -p.amount } : {}),
              },
            },
          )
          .exec();
        const existingTxn = await this.txnModel.findOne({ idempotencyKey: p.idempotencyKey }).exec();
        if (existingTxn) return existingTxn;
      }
      throw err;
    }
  }

  // ----------- Cross-wallet transfer (gift send, etc.) -----------

  /**
   * Atomically deduct coins from sender and credit beans to receiver.
   * Uses a MongoDB transaction. Idempotent on `idempotencyKey`.
   */
  async transferGift(p: GiftTransferParams): Promise<{
    senderTxn: TransactionDocument;
    receiverTxn: TransactionDocument;
  }> {
    if (p.coinAmount <= 0 || p.beanReward < 0) {
      throw new BadRequestException({ code: 'INVALID_AMOUNTS', message: 'Invalid amounts' });
    }
    if (p.senderUserId === p.receiverUserId) {
      throw new BadRequestException({ code: 'SELF_GIFT', message: 'Cannot gift yourself' });
    }

    const existing = await this.txnModel.find({ correlationId: p.idempotencyKey }).exec();
    if (existing.length === 2) {
      const sender = existing.find((t) => t.direction === TxnDirection.DEBIT)!;
      const receiver = existing.find((t) => t.direction === TxnDirection.CREDIT)!;
      return { senderTxn: sender, receiverTxn: receiver };
    }

    const session = await this.connection.startSession();
    try {
      let senderTxn!: TransactionDocument;
      let receiverTxn!: TransactionDocument;

      await session.withTransaction(async () => {
        const senderObj = new Types.ObjectId(p.senderUserId);
        const receiverObj = new Types.ObjectId(p.receiverUserId);

        const senderWallet = await this.walletModel.findOneAndUpdate(
          { userId: senderObj, frozen: false, coins: { $gte: p.coinAmount } },
          { $inc: { coins: -p.coinAmount, lifetimeCoinsSpent: p.coinAmount } },
          { new: true, session },
        );
        if (!senderWallet) {
          throw new BadRequestException({
            code: 'INSUFFICIENT_OR_FROZEN',
            message: 'Sender has insufficient coins or wallet is frozen',
          });
        }

        const receiverWallet = await this.walletModel.findOneAndUpdate(
          { userId: receiverObj, frozen: false },
          {
            $inc: { beans: p.beanReward, lifetimeBeansEarned: p.beanReward },
            $setOnInsert: { userId: receiverObj },
          },
          { new: true, upsert: true, session },
        );
        if (!receiverWallet) {
          throw new ForbiddenException({
            code: 'RECEIVER_WALLET_FROZEN',
            message: 'Receiver wallet is frozen',
          });
        }

        const senderKey = `${p.idempotencyKey}:debit`;
        const receiverKey = `${p.idempotencyKey}:credit`;

        const inserted = await this.txnModel.insertMany(
          [
            {
              idempotencyKey: senderKey,
              correlationId: p.idempotencyKey,
              walletId: senderWallet._id,
              userId: senderObj,
              currency: Currency.COINS,
              direction: TxnDirection.DEBIT,
              amount: p.coinAmount,
              type: TxnType.GIFT_SEND,
              description: p.description ?? 'Gift sent',
              refType: 'gift',
              refId: p.giftId && Types.ObjectId.isValid(p.giftId) ? new Types.ObjectId(p.giftId) : null,
              balanceAfter: senderWallet.coins,
              status: TxnStatus.COMPLETED,
            },
            {
              idempotencyKey: receiverKey,
              correlationId: p.idempotencyKey,
              walletId: receiverWallet._id,
              userId: receiverObj,
              currency: Currency.BEANS,
              direction: TxnDirection.CREDIT,
              amount: p.beanReward,
              type: TxnType.GIFT_RECEIVE,
              description: p.description ?? 'Gift received',
              refType: 'gift',
              refId: p.giftId && Types.ObjectId.isValid(p.giftId) ? new Types.ObjectId(p.giftId) : null,
              balanceAfter: receiverWallet.beans,
              status: TxnStatus.COMPLETED,
            },
          ],
          { session },
        );

        senderTxn = inserted[0] as TransactionDocument;
        receiverTxn = inserted[1] as TransactionDocument;
      });

      return { senderTxn, receiverTxn };
    } finally {
      await session.endSession();
    }
  }

  // ----------- Admin freeze / unfreeze -----------

  async freeze(userId: string, reason: string, by: string): Promise<WalletDocument> {
    const wallet = await this.getOrCreate(userId);
    wallet.frozen = true;
    wallet.frozenReason = reason;
    wallet.frozenAt = new Date();
    wallet.frozenBy = Types.ObjectId.isValid(by) ? new Types.ObjectId(by) : null;
    await wallet.save();
    return wallet;
  }

  async unfreeze(userId: string): Promise<WalletDocument> {
    const wallet = await this.findByUserId(userId);
    if (!wallet) throw new NotFoundException('Wallet not found');
    wallet.frozen = false;
    wallet.frozenReason = '';
    wallet.frozenAt = null;
    wallet.frozenBy = null;
    await wallet.save();
    return wallet;
  }

  // ----------- Transactions -----------

  async listTransactions(params: ListTransactionsParams) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 50));
    const skip = (page - 1) * limit;

    const filter: FilterQuery<TransactionDocument> = {};
    if (params.userId && Types.ObjectId.isValid(params.userId)) {
      filter.userId = new Types.ObjectId(params.userId);
    }
    if (params.walletId && Types.ObjectId.isValid(params.walletId)) {
      filter.walletId = new Types.ObjectId(params.walletId);
    }
    if (params.currency) filter.currency = params.currency;
    if (params.type) filter.type = params.type;
    if (params.direction) filter.direction = params.direction;
    if (params.from || params.to) {
      filter.createdAt = {};
      if (params.from) (filter.createdAt as any).$gte = params.from;
      if (params.to) (filter.createdAt as any).$lte = params.to;
    }

    const [items, total] = await Promise.all([
      this.txnModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.txnModel.countDocuments(filter).exec(),
    ]);
    return { items, page, limit, total };
  }

  /** Generate a server-side idempotency key for actions that don't supply one. */
  generateKey(prefix: string): string {
    return `${prefix}:${nanoid(16)}`;
  }

  // ----------- helpers -----------

  private lifetimeFieldFor(
    currency: Currency,
    direction: TxnDirection,
    type: TxnType,
  ): string | null {
    if (currency === Currency.COINS && direction === TxnDirection.CREDIT) {
      if (
        type === TxnType.RECHARGE ||
        type === TxnType.RECHARGE_BONUS ||
        type === TxnType.MINT ||
        type === TxnType.RESELLER_TOPUP
      ) {
        // All "coins coming into the platform" channels increment this counter
        // (real recharge, admin mint, or reseller assignment).
        return 'lifetimeCoinsRecharged';
      }
    }
    if (currency === Currency.COINS && direction === TxnDirection.DEBIT) {
      if (type === TxnType.GIFT_SEND) return 'lifetimeCoinsSpent';
    }
    if (currency === Currency.BEANS && direction === TxnDirection.CREDIT) {
      if (type === TxnType.GIFT_RECEIVE) return 'lifetimeBeansEarned';
    }
    if (currency === Currency.BEANS && direction === TxnDirection.DEBIT) {
      if (type === TxnType.WITHDRAWAL) return 'lifetimeBeansWithdrawn';
    }
    return null;
  }
}
