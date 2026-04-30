import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GiftListingDto, PurchaseListingDto } from './dto/purchase.dto';
import { StoreCategory } from './schemas/store-listing.schema';
import { StoreService } from './store.service';

@Controller({ path: 'store', version: '1' })
export class StoreController {
  constructor(private readonly store: StoreService) {}

  @Public()
  @Get('listings')
  async list(
    @Query('category') category?: StoreCategory,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.store.listForUsers({ category, page, limit });
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('purchase')
  async purchase(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: PurchaseListingDto,
  ) {
    return this.store.purchase({
      buyerUserId: current.userId,
      listingId: dto.listingId,
      idempotencyKey: dto.idempotencyKey,
    });
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('gift')
  async gift(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: GiftListingDto,
  ) {
    return this.store.gift({
      senderUserId: current.userId,
      listingId: dto.listingId,
      receiverId: dto.receiverId,
      receiverNumericId: dto.receiverNumericId,
      idempotencyKey: dto.idempotencyKey,
      message: dto.message,
    });
  }
}
