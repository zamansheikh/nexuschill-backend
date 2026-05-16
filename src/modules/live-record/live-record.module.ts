import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import {
  LiveSession,
  LiveSessionSchema,
} from '../rooms/schemas/live-session.schema';
import { SystemConfigModule } from '../system-config/system-config.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { WalletModule } from '../wallet/wallet.module';
import { LiveRecordController } from './live-record.controller';
import { LiveRecordCron } from './live-record.cron';
import { LiveRecordService } from './live-record.service';
import {
  LiveDayRecord,
  LiveDayRecordSchema,
} from './schemas/live-day-record.schema';
import {
  LiveMonthRecord,
  LiveMonthRecordSchema,
} from './schemas/live-month-record.schema';

/**
 * Host live-record rewards module.
 *
 *   • Tracks per-day live time per host, audio + video separately
 *     (LiveDayRecord).
 *   • Credits a configurable daily reward to hosts who cross the
 *     valid-day threshold (cron runs hourly, idempotent per date).
 *   • Lets hosts claim a configurable monthly bonus once they hit
 *     the valid-month threshold (LiveMonthRecord ledger).
 *   • Generates a PDF certificate post-claim.
 *
 * The User schema is registered locally (rather than importing the
 * full UsersModule) so the PDF generator can read display name and
 * numeric id without dragging the user module's dependency graph.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: LiveDayRecord.name, schema: LiveDayRecordSchema },
      { name: LiveMonthRecord.name, schema: LiveMonthRecordSchema },
      { name: LiveSession.name, schema: LiveSessionSchema },
      { name: User.name, schema: UserSchema },
    ]),
    SystemConfigModule,
    WalletModule,
  ],
  controllers: [LiveRecordController],
  providers: [LiveRecordService, LiveRecordCron],
  exports: [LiveRecordService],
})
export class LiveRecordModule {}
