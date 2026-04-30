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
} from '@nestjs/common';

import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { UsersService } from '../users/users.service';
import { GiftsService } from './gifts.service';
import { SendGiftDto } from './dto/gift.dto';
import { GiftCategory } from './schemas/gift.schema';

@Controller({ path: 'gifts', version: '1' })
export class GiftsController {
  constructor(
    private readonly gifts: GiftsService,
    private readonly users: UsersService,
  ) {}

  /**
   * Catalog visible to the calling user — country & VIP filters applied.
   */
  @Get('catalog')
  async catalog(
    @CurrentUser() current: AuthenticatedUser,
    @Query('category') category?: GiftCategory,
  ) {
    const user = await this.users.getByIdOrThrow(current.userId);
    return this.gifts.list({
      active: true,
      category,
      forCountry: user.country,
      limit: 100,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('send')
  async send(@CurrentUser() current: AuthenticatedUser, @Body() dto: SendGiftDto) {
    if (!dto.idempotencyKey) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'idempotencyKey is required to prevent double-sends',
      });
    }
    const result = await this.gifts.sendGift({
      senderId: current.userId,
      receiverId: dto.receiverId,
      giftId: dto.giftId,
      count: dto.count,
      contextType: dto.contextType,
      contextId: dto.contextId,
      message: dto.message,
      idempotencyKey: dto.idempotencyKey,
    });
    return { event: result.event, wallet: result.senderWallet };
  }

  @Get('me/sent')
  async mySent(
    @CurrentUser() current: AuthenticatedUser,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.gifts.listSentBy(current.userId, page, limit);
  }

  @Get('me/received')
  async myReceived(
    @CurrentUser() current: AuthenticatedUser,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.gifts.listReceivedBy(current.userId, page, limit);
  }

  /** Public gift wall for any user. */
  @Public()
  @Get('wall/:userId')
  async wall(@Param('userId') userId: string) {
    const top = await this.gifts.giftWall(userId);
    return { wall: top };
  }
}
