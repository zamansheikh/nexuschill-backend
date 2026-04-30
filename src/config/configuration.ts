export const configuration = () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  api: {
    prefix: process.env.API_PREFIX || 'api',
    version: process.env.API_VERSION || 'v1',
  },
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/nexuschill',
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0', 10),
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || '',
    accessExpires: process.env.JWT_ACCESS_EXPIRES || '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET || '',
    refreshExpires: process.env.JWT_REFRESH_EXPIRES || '30d',
  },
  adminJwt: {
    accessSecret: process.env.JWT_ADMIN_ACCESS_SECRET || '',
    accessExpires: process.env.JWT_ADMIN_ACCESS_EXPIRES || '30m',
    refreshSecret: process.env.JWT_ADMIN_REFRESH_SECRET || '',
    refreshExpires: process.env.JWT_ADMIN_REFRESH_EXPIRES || '7d',
  },
  security: {
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),
  },
  otp: {
    length: parseInt(process.env.OTP_LENGTH || '6', 10),
    expirySeconds: parseInt(process.env.OTP_EXPIRY_SECONDS || '300', 10),
    maxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS || '5', 10),
    resendCooldownSeconds: parseInt(process.env.OTP_RESEND_COOLDOWN_SECONDS || '60', 10),
  },
  cors: {
    origin: process.env.CORS_ORIGIN || '',
  },
  throttle: {
    ttl: parseInt(process.env.THROTTLE_TTL_SECONDS || '60', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT || '100', 10),
  },
  superAdmin: {
    email: process.env.SUPER_ADMIN_EMAIL || '',
    password: process.env.SUPER_ADMIN_PASSWORD || '',
    username: process.env.SUPER_ADMIN_USERNAME || 'superadmin',
  },
  sms: {
    provider: process.env.SMS_PROVIDER || 'stub',
    twilio: {
      accountSid: process.env.TWILIO_ACCOUNT_SID,
      authToken: process.env.TWILIO_AUTH_TOKEN,
      fromNumber: process.env.TWILIO_FROM_NUMBER,
    },
  },
  email: {
    provider: process.env.EMAIL_PROVIDER || 'stub',
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT || '587', 10),
    secure: (process.env.EMAIL_SECURE || 'false').toLowerCase() === 'true',
    user: process.env.EMAIL_USER || '',
    pass: process.env.EMAIL_PASS || '',
    sendgridApiKey: process.env.SENDGRID_API_KEY,
    from: process.env.EMAIL_FROM || 'no-reply@nexuschill.com',
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
    uploadPreset: process.env.CLOUDINARY_UPLOAD_PRESET || '',
    folder: process.env.CLOUDINARY_FOLDER || 'party-app',
  },
  google: {
    /**
     * Web client ID auto-created by Firebase when Google Sign-In is enabled.
     * Found in google-services.json → "oauth_client" entries with `client_type: 3`.
     * The mobile app's `GoogleSignIn(serverClientId: ...)` MUST match this so
     * that the resulting ID token's `aud` claim is verifiable here.
     *
     * You can list multiple comma-separated IDs (e.g. web + iOS) — the verifier
     * accepts any.
     */
    clientIds: (process.env.GOOGLE_CLIENT_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },
});
