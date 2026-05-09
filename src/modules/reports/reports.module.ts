import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Moment, MomentSchema } from '../moments/schemas/moment.schema';
import { Room, RoomSchema } from '../rooms/schemas/room.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { AdminReportsController } from './admin-reports.controller';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { UserReport, UserReportSchema } from './schemas/user-report.schema';

/**
 * User reports — the in-app "Report" surface required by Google Play's
 * User Safety policy.
 *
 * Module is intentionally self-contained: it registers the schemas it
 * needs to validate target existence (User / Room / Moment) directly
 * via `forFeature` rather than importing the owning modules — same
 * pattern as SocialModule, and avoids module cycles when reports
 * surface deep inside controllers (rooms, profile, chat) we'd
 * otherwise have to import.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UserReport.name, schema: UserReportSchema },
      { name: User.name, schema: UserSchema },
      { name: Room.name, schema: RoomSchema },
      { name: Moment.name, schema: MomentSchema },
    ]),
  ],
  controllers: [ReportsController, AdminReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
