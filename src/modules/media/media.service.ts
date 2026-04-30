import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UploadApiOptions, UploadApiResponse, v2 as cloudinary } from 'cloudinary';

export interface UploadParams {
  /** Subfolder under the configured root folder (e.g. "avatars"). */
  folder: string;
  /** Optional explicit public_id (without folder). Use to overwrite existing. */
  publicId?: string;
  overwrite?: boolean;
  /** Cloudinary transformation array. */
  transformation?: UploadApiOptions['transformation'];
}

@Injectable()
export class MediaService implements OnModuleInit {
  private readonly logger = new Logger(MediaService.name);
  private rootFolder = 'party-app';
  private configured = false;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const cloudName = this.config.get<string>('cloudinary.cloudName');
    const apiKey = this.config.get<string>('cloudinary.apiKey');
    const apiSecret = this.config.get<string>('cloudinary.apiSecret');
    this.rootFolder = this.config.get<string>('cloudinary.folder') || 'party-app';

    if (!cloudName || !apiKey || !apiSecret) {
      this.logger.warn(
        'Cloudinary credentials not configured — image uploads will fail until set.',
      );
      return;
    }

    cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
    this.configured = true;
    this.logger.log(`Cloudinary configured (cloud: ${cloudName}, root folder: ${this.rootFolder})`);
  }

  private assertReady() {
    if (!this.configured) {
      throw new ServiceUnavailableException({
        code: 'MEDIA_NOT_CONFIGURED',
        message: 'Image upload provider is not configured',
      });
    }
  }

  /**
   * Upload a buffer (from multer) to Cloudinary. Resolves with the upload result
   * including `secure_url` and `public_id`.
   */
  uploadImage(buffer: Buffer, params: UploadParams): Promise<UploadApiResponse> {
    this.assertReady();
    const folder = `${this.rootFolder}/${params.folder}`;

    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder,
          public_id: params.publicId,
          overwrite: params.overwrite ?? true,
          resource_type: 'image',
          transformation: params.transformation,
        },
        (err, result) => {
          if (err) return reject(err);
          if (!result) return reject(new Error('Cloudinary returned no result'));
          resolve(result);
        },
      );
      stream.end(buffer);
    });
  }

  async deleteImage(publicId: string): Promise<void> {
    if (!publicId) return;
    this.assertReady();
    try {
      await cloudinary.uploader.destroy(publicId);
    } catch (err) {
      // Don't fail the parent operation if cleanup fails — log only.
      this.logger.warn(`Failed to delete Cloudinary asset ${publicId}: ${(err as Error).message}`);
    }
  }

  /**
   * Generate a signature for direct client-side upload to Cloudinary.
   * Client posts the file + signature + timestamp + api_key to:
   *   POST https://api.cloudinary.com/v1_1/<cloud_name>/image/upload
   */
  generateUploadSignature(folder: string, publicId?: string) {
    this.assertReady();
    const apiKey = this.config.get<string>('cloudinary.apiKey')!;
    const apiSecret = this.config.get<string>('cloudinary.apiSecret')!;
    const cloudName = this.config.get<string>('cloudinary.cloudName')!;

    const timestamp = Math.round(Date.now() / 1000);
    const fullFolder = `${this.rootFolder}/${folder}`;

    const paramsToSign: Record<string, string | number> = { timestamp, folder: fullFolder };
    if (publicId) paramsToSign.public_id = publicId;

    const signature = cloudinary.utils.api_sign_request(paramsToSign, apiSecret);

    return {
      cloudName,
      apiKey,
      timestamp,
      folder: fullFolder,
      publicId: publicId ?? null,
      signature,
      uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    };
  }
}
