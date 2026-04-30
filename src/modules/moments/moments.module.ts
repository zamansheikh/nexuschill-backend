import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { MomentsAdminController } from './moments-admin.controller';
import { MomentsController } from './moments.controller';
import { MomentsService } from './moments.service';
import {
  MomentComment,
  MomentCommentSchema,
} from './schemas/moment-comment.schema';
import { MomentLike, MomentLikeSchema } from './schemas/moment-like.schema';
import { Moment, MomentSchema } from './schemas/moment.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Moment.name, schema: MomentSchema },
      { name: MomentLike.name, schema: MomentLikeSchema },
      { name: MomentComment.name, schema: MomentCommentSchema },
    ]),
  ],
  controllers: [MomentsController, MomentsAdminController],
  providers: [MomentsService],
  exports: [MomentsService],
})
export class MomentsModule {}
