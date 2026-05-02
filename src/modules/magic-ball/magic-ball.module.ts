import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AdminAuthModule } from '../admin/admin-auth/admin-auth.module';
import { WalletModule } from '../wallet/wallet.module';
import { AdminMagicBallController } from './admin-magic-ball.controller';
import { MagicBallController } from './magic-ball.controller';
import { MagicBallService } from './magic-ball.service';
import {
  MagicBallProgress,
  MagicBallProgressSchema,
} from './schemas/magic-ball-progress.schema';
import {
  MagicBallTask,
  MagicBallTaskSchema,
} from './schemas/magic-ball-task.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MagicBallTask.name, schema: MagicBallTaskSchema },
      { name: MagicBallProgress.name, schema: MagicBallProgressSchema },
    ]),
    WalletModule, // exposes WalletService.credit for claim()
    AdminAuthModule,
  ],
  controllers: [MagicBallController, AdminMagicBallController],
  providers: [MagicBallService],
  // Exported so future RoomsService / GiftsService hooks can call
  // `incrementProgress(...)` without going through the HTTP layer.
  exports: [MagicBallService],
})
export class MagicBallModule {}
