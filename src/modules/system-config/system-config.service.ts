import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { AppConfig, AppConfigDocument } from './schemas/app-config.schema';

const SINGLETON_KEY = 'singleton';

interface UpdateAppConfigInput {
  familiesEnabled?: boolean;
  agenciesEnabled?: boolean;
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
}
