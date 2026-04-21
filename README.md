# Party App — Backend

Production-grade Node.js backend for the Party App.

**Tech:** Node.js + NestJS + MongoDB + Redis + JWT

---

## Quick Start

### 1. Prerequisites
- Node.js 20+ (LTS)
- Docker + Docker Compose (for MongoDB + Redis)

### 2. Install
```bash
cd backend
npm install
```

### 3. Configure
```bash
cp .env.example .env
# Generate JWT secrets:
#   openssl rand -base64 48
# (or on Windows) node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
# Paste into .env for JWT_ACCESS_SECRET and JWT_REFRESH_SECRET
```

### 4. Start MongoDB + Redis
```bash
docker compose up -d
```

- Mongo on `localhost:27017`
- Redis on `localhost:6379`
- Mongo UI (dev only) on `http://localhost:8081`

### 5. Run the backend
```bash
npm run start:dev
```

API is now at `http://localhost:3000/api/v1`.

Health check: `http://localhost:3000/api/v1/health`

---

## Auth Endpoints (Phase 1 — Implemented)

All responses use a standardized envelope:
```json
{
  "success": true,
  "data": { ... },
  "error": null,
  "meta": { "traceId": "xyz" }
}
```

### Register with email + password
```
POST /api/v1/auth/register/email
Body: { "email": "user@example.com", "password": "Pass1234!", "username": "alice" }
Returns: { user, tokens: { access, refresh } }
```

### Login with email + password
```
POST /api/v1/auth/login/email
Body: { "email": "user@example.com", "password": "Pass1234!" }
Returns: { user, tokens }
```

### Send OTP to phone (for register or login)
```
POST /api/v1/auth/otp/send
Body: { "phone": "+8801XXXXXXXXX" }
Returns: { sent: true, cooldownSeconds: 60 }
```
> In development, the OTP is logged to the console. In production it's sent via SMS gateway.

### Verify OTP (registers new user if phone is unseen, logs in if existing)
```
POST /api/v1/auth/otp/verify
Body: { "phone": "+8801XXXXXXXXX", "otp": "123456" }
Returns: { user, tokens, isNewUser }
```

### Refresh access token
```
POST /api/v1/auth/refresh
Body: { "refreshToken": "..." }
Returns: { tokens }
```

### Logout (revokes refresh token)
```
POST /api/v1/auth/logout
Authorization: Bearer <accessToken>
Body: { "refreshToken": "..." }
Returns: { success: true }
```

### Get current user
```
GET /api/v1/auth/me
Authorization: Bearer <accessToken>
Returns: { user }
```

---

## Project Structure

```
backend/
├── src/
│   ├── main.ts                      Bootstrap + global config
│   ├── app.module.ts                Root module
│   ├── app.controller.ts            Health check
│   ├── config/                      Environment config + validation
│   ├── common/                      Shared code (filters, interceptors, decorators)
│   ├── database/                    Mongoose connection
│   ├── redis/                       Redis client
│   └── modules/
│       ├── users/                   User domain (schema, service)
│       └── auth/                    Auth feature (register/login/OTP/JWT)
│           ├── dto/                 Request validation schemas
│           ├── schemas/             MongoDB schemas (refresh tokens)
│           ├── services/            Token, OTP services
│           ├── strategies/          Passport JWT strategy
│           ├── guards/              JWT auth guard
│           ├── auth.controller.ts
│           ├── auth.service.ts
│           └── auth.module.ts
├── .env.example
├── docker-compose.yml
├── Dockerfile
└── package.json
```

---

## Testing the Auth Flow

### Using curl (or Postman)

**1. Register**
```bash
curl -X POST http://localhost:3000/api/v1/auth/register/email \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"Pass1234!","username":"alice"}'
```

**2. Login**
```bash
curl -X POST http://localhost:3000/api/v1/auth/login/email \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"Pass1234!"}'
```

**3. Phone OTP flow**
```bash
# send OTP
curl -X POST http://localhost:3000/api/v1/auth/otp/send \
  -H "Content-Type: application/json" \
  -d '{"phone":"+8801700000000"}'

# check the backend console — you'll see: "[DEV] OTP for +8801700000000: 123456"

curl -X POST http://localhost:3000/api/v1/auth/otp/verify \
  -H "Content-Type: application/json" \
  -d '{"phone":"+8801700000000","otp":"123456"}'
```

**4. Access protected endpoint**
```bash
curl http://localhost:3000/api/v1/auth/me \
  -H "Authorization: Bearer <access_token>"
```

---

## What's Implemented (Auth Feature)

- [x] Email + password registration with bcrypt
- [x] Email + password login
- [x] Phone OTP send (rate-limited, stubbed SMS — logs to console)
- [x] Phone OTP verify with auto-register
- [x] JWT access tokens (15m) + refresh tokens (30d, rotated)
- [x] Refresh token revocation (logout)
- [x] `/auth/me` protected endpoint
- [x] Rate limiting on sensitive endpoints
- [x] Standardized response envelope
- [x] Global exception filter
- [x] Request trace IDs
- [x] Input validation (class-validator)
- [x] Security headers (helmet)
- [x] Structured logging (pino)
- [x] MongoDB indexes on email, phone, username
- [x] Redis for OTP + rate limiting

## What's Next (will be added in future phases)

- [ ] Google / Facebook / Apple OAuth
- [ ] Password reset via email
- [ ] 2FA (TOTP)
- [ ] Device binding
- [ ] Admin panel for user management (Phase 1.5)
- [ ] User profile module (avatars, bio, follow/unfollow)
- [ ] Wallet & gifts (Phase 2)

---

## Scripts

```bash
npm run start:dev     # dev with watch
npm run start:debug   # dev with debugger
npm run start:prod    # production
npm run build         # compile TypeScript
npm run lint          # ESLint
npm run format        # Prettier
npm test              # unit tests
npm run test:cov      # coverage
```
