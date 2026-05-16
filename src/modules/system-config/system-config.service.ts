import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { AppConfig, AppConfigDocument } from './schemas/app-config.schema';

const SINGLETON_KEY = 'singleton';

interface UpdateAppConfigInput {
  familiesEnabled?: boolean;
  agenciesEnabled?: boolean;
  emailLoginEnabled?: boolean;
  phoneLoginEnabled?: boolean;
  liveRequiresAgency?: boolean;
  audioHostEndsLive?: boolean;
}

/**
 * Single-doc store for runtime feature toggles. Reads are upsert-on-miss
 * so callers never have to handle "config doesn't exist yet" — the first
 * boot lazily creates the doc with schema defaults.
 */
@Injectable()
export class SystemConfigService {
  constructor(
    @InjectModel(AppConfig.name) private readonly model: Model<AppConfigDocument>,
  ) {}

  async getConfig(): Promise<AppConfigDocument> {
    return this.model
      .findOneAndUpdate(
        { key: SINGLETON_KEY },
        { $setOnInsert: { key: SINGLETON_KEY } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
  }

  async updateConfig(update: UpdateAppConfigInput): Promise<AppConfigDocument> {
    const set: Record<string, unknown> = {};
    if (update.familiesEnabled !== undefined) set.familiesEnabled = update.familiesEnabled;
    if (update.agenciesEnabled !== undefined) set.agenciesEnabled = update.agenciesEnabled;
    if (update.emailLoginEnabled !== undefined) {
      set.emailLoginEnabled = update.emailLoginEnabled;
    }
    if (update.phoneLoginEnabled !== undefined) {
      set.phoneLoginEnabled = update.phoneLoginEnabled;
    }
    if (update.liveRequiresAgency !== undefined) {
      set.liveRequiresAgency = update.liveRequiresAgency;
    }
    if (update.audioHostEndsLive !== undefined) {
      set.audioHostEndsLive = update.audioHostEndsLive;
    }
    return this.model
      .findOneAndUpdate(
        { key: SINGLETON_KEY },
        { $set: set, $setOnInsert: { key: SINGLETON_KEY } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
  }

  /** Convenience accessor used by other modules' guards. */
  async familiesEnabled(): Promise<boolean> {
    const cfg = await this.getConfig();
    return cfg.familiesEnabled;
  }

  async agenciesEnabled(): Promise<boolean> {
    const cfg = await this.getConfig();
    return cfg.agenciesEnabled;
  }

  /**
   * Used by the rooms module to gate room creation — when this is
   * true, only `isHost` users may open an audio / video room.
   */
  async liveRequiresAgency(): Promise<boolean> {
    const cfg = await this.getConfig();
    return cfg.liveRequiresAgency;
  }

  /**
   * Used by the rooms module to decide whether the audio room should
   * be torn down when the host walks away — explicit leave OR
   * heartbeat stale past the grace window. Mirrors video-room
   * behaviour when on; leaves audio rooms as a persistent venue when
   * off.
   */
  async audioHostEndsLive(): Promise<boolean> {
    const cfg = await this.getConfig();
    return cfg.audioHostEndsLive;
  }
}
