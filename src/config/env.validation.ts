import { plainToInstance } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MinLength, validateSync } from 'class-validator';

enum NodeEnv {
  development = 'development',
  production = 'production',
  test = 'test',
}

class EnvVars {
  @IsEnum(NodeEnv)
  @IsOptional()
  NODE_ENV?: NodeEnv;

  @IsOptional()
  PORT?: string;

  @IsString()
  MONGODB_URI!: string;

  @IsString()
  REDIS_HOST!: string;

  @IsString()
  @MinLength(32, { message: 'JWT_ACCESS_SECRET must be at least 32 characters' })
  JWT_ACCESS_SECRET!: string;

  @IsString()
  @MinLength(32, { message: 'JWT_REFRESH_SECRET must be at least 32 characters' })
  JWT_REFRESH_SECRET!: string;

  @IsString()
  @MinLength(32, { message: 'JWT_ADMIN_ACCESS_SECRET must be at least 32 characters' })
  JWT_ADMIN_ACCESS_SECRET!: string;

  @IsString()
  @MinLength(32, { message: 'JWT_ADMIN_REFRESH_SECRET must be at least 32 characters' })
  JWT_ADMIN_REFRESH_SECRET!: string;
}

export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvVars, config, { enableImplicitConversion: true });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(
      'Environment validation failed:\n' +
        errors.map((e) => `  - ${Object.values(e.constraints || {}).join(', ')}`).join('\n'),
    );
  }
  return validated;
}
