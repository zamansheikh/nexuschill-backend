# `backend/secrets/`

Local credential files. **Anything you drop here is gitignored** —
this README and any other `.md` are the only files that get committed.
Never check in keys, JSON service accounts, or `.env`-style files.

## What lives here

### `firebase-service-account.json` (required)

Firebase Admin SDK service account. Used for two things on the backend:

1. **Token verification** — the mobile app signs in with Firebase Auth and
   sends the resulting ID token; we verify it via `firebase-admin`.
2. **FCM push delivery** — the admin panel and message-driven flows
   call `messaging().sendEachForMulticast()` to push to user devices.
   Without this file, FCM sends silently no-op (in-app realtime + the
   Notifications tab still work, but the OS notification tray stays empty).

#### How to get it

1. [Firebase Console](https://console.firebase.google.com) →
   pick the project (`nexuschill-e3ecc`) → **Project Settings**
   (gear icon) → **Service Accounts** tab.
2. Click **"Generate new private key"** → confirm. A JSON file downloads.
3. Move/rename it to **`backend/secrets/firebase-service-account.json`**.
4. (Optional) Set permissions to `0600` on Unix.

#### How the backend finds it

Two paths, controlled by env vars:

- `FIREBASE_SERVICE_ACCOUNT_PATH` — file path (default in `.env.example`:
  `./secrets/firebase-service-account.json`, relative to `backend/`).
- `FIREBASE_SERVICE_ACCOUNT_JSON` — inline JSON content. Set this in cloud
  deploys (Render, Railway, Fly.io) where mounting a file is awkward.
  Takes precedence over the path-based loader.

Docker Compose overrides `FIREBASE_SERVICE_ACCOUNT_PATH` to the
in-container mount target (`/run/secrets/firebase-service-account.json`)
and bind-mounts this file read-only.

#### Verifying it's working

On backend boot you should see one of:

```
Firebase Admin initialized for project "<id>" (with credentials — FCM enabled)
Firebase Admin initialized for project "<id>" (no credentials — FCM disabled, verification only)
Failed to load Firebase service-account (FCM will be disabled): <reason>
```

The first line is the goal. The second means the file isn't loading
but auth still works. The third tells you why loading failed.

## Rotation

If a service account leaks (committed by accident, exposed in logs,
shared in chat), **rotate immediately**:

1. Firebase Console → Service Accounts → revoke the leaked key.
2. Generate a new one (steps above).
3. Replace `firebase-service-account.json` here.
4. Restart the backend.

The rest of the system needs no changes — `firebase-admin` reads the
file fresh on init.
