# Deploy scripts

Two-step deploy for the NestJS backend:

| Script | When to run | Where |
|---|---|---|
| [`server-bootstrap.sh`](server-bootstrap.sh) | Once, the very first time you stand up a host | Manually, on the server (as root) |
| [`deploy.sh`](deploy.sh) | Every code push | Automatically, via GitHub Actions |

The `appleboy/ssh-action` step in [.github/workflows/deploy.yml](../.github/workflows/deploy.yml) SSHes into the server, pulls `origin/main`, and runs `deploy.sh`.

## First-time setup

1. **On a fresh Debian/Ubuntu server**, run:
   ```bash
   curl -sSL https://raw.githubusercontent.com/zamansheikh/nexuschill-backend/main/scripts/server-bootstrap.sh \
     | bash -s -- https://github.com/zamansheikh/nexuschill-backend.git
   ```
   This installs Docker + Compose, clones the repo to `/opt/nexuschill-backend`, opens UFW for SSH + port 3000, and prints the manual steps below.

2. **Drop in `.env`** — copy from `.env.example` and fill in real secrets (MongoDB URI, JWT secrets, Cloudinary keys, etc.).

3. **Drop in `secrets/firebase-service-account.json`** — required for FCM push. See [`secrets/README.md`](../secrets/README.md).

4. **Add GitHub Actions secrets** (Settings → Secrets and variables → Actions):
   - `SSH_HOST` — the server's IP (e.g. `31.97.15.225`)
   - `SSH_USER` — `root`
   - `SSH_PRIVATE_KEY` — the **entire** content of the matching SSH private key (including the `-----BEGIN ... PRIVATE KEY-----` header). The corresponding public key must be in `~/.ssh/authorized_keys` on the server.
   - `SSH_PORT` — optional, only if you've changed sshd from 22.

5. **Push to `main`.** CI takes over from there.

## Generating an SSH key for CI

If you don't already have one dedicated to CI:

```bash
# On your laptop — DON'T reuse a personal key
ssh-keygen -t ed25519 -C "github-actions@nexuschill-backend" -f ~/.ssh/nexuschill_deploy

# Copy the public key to the server
ssh-copy-id -i ~/.ssh/nexuschill_deploy.pub root@31.97.15.225

# Print the private key (paste into GitHub secret SSH_PRIVATE_KEY)
cat ~/.ssh/nexuschill_deploy
```

## What `deploy.sh` checks

Before touching containers, it validates:

1. `git`, `docker`, `docker compose`, `curl` are installed.
2. Repo at `/opt/nexuschill-backend` exists with a working `.git`.
3. `.env` is present (operator-managed; never overwritten).
4. `secrets/firebase-service-account.json` is present and has a `private_key` field — warns if missing (FCM will silently no-op).
5. Docker daemon is reachable.
6. Disk has > 2 GB free; RAM has > 512 MB free (warn-only).
7. Critical `.env` keys (`MONGODB_URI`, `JWT_ACCESS_SECRET`, `REDIS_HOST`) are non-empty.

After validation:

8. Stops existing containers (`docker compose down`).
9. Rebuilds images (`docker compose build --pull`).
10. Starts containers (`docker compose up -d`).
11. Polls `http://localhost:3000/api/v1/moments?limit=1` for up to 90 seconds. On failure, dumps the last 80 log lines and exits 1.
12. Prunes dangling images.

## Manual deploy

If you ever want to redeploy without pushing a commit:

```bash
# On the server
nexuschill-deploy
```

(`server-bootstrap.sh` symlinked `scripts/deploy.sh` → `/usr/local/bin/nexuschill-deploy`.)

You can also re-trigger the GitHub Actions workflow from the repo's Actions tab → **Deploy backend** → **Run workflow**.

## Rolling back

CI deploys whatever is at `origin/main`. To roll back:

```bash
git revert <bad-sha>
git push                      # CI redeploys the revert commit
```

Or skip CI and roll back directly on the server:

```bash
ssh root@31.97.15.225
cd /opt/nexuschill-backend
git reset --hard <known-good-sha>
nexuschill-deploy
```
