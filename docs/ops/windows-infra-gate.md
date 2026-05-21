# Windows Infra Gate

This release gate requires real Postgres and Redis connectivity. It does not skip infra, security, or compliance checks.

Runtime profile policy is documented in `docs/ops/runtime-profiles.md`. In short:

- `soft-zero-cost` can run without Redis only when it is single-instance, cached-only, and Free zero-cost guards are safe.
- `paid-live` requires Redis when live scans, provider collection, or scan workers are enabled.
- `production-full` requires Redis and Postgres.

## Recommended free path

Docker Desktop is not required for this repository. On Windows, prefer Docker Engine inside WSL2 or already running Postgres/Redis services.

Recommended command:

```bash
npm run app:start
```

This starts the full compose app through WSL/Linux Docker Engine and exposes:

- App: `http://127.0.0.1:8080`
- API: `http://localhost:3000`

Recommended release gate:

```bash
npm run release:prod:gate:free
```

This runs Docker from inside WSL2 and then performs real Postgres and Redis healthchecks from the release gate.

## Opzione A - WSL2 + Docker Engine

Use this when Docker Engine runs inside WSL2.

```bash
npm run release:prod:gate:wsl
```

Quick verification from PowerShell:

```powershell
wsl sh -lc "command -v docker && docker info --format 'name={{.Name}} os={{.OperatingSystem}} root={{.DockerRootDir}}'"
```

The free path is valid only if the output does not mention `docker-desktop` or `Docker Desktop`.

Typical WSL setup path:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
sudo service docker start
docker info
```

Then reopen the WSL shell before running the release gate again.

Optional distro selection:

```bash
cross-env WSL_DISTRO=Ubuntu INFRA_MODE=wsl-docker node scripts/release-prod-gate.mjs
```

The gate runs Docker commands inside WSL and verifies Postgres/Redis from Windows through `DATABASE_URL` and `REDIS_URL` defaults or env values.

## Opzione B - Postgres/Redis locali o esterni

Use this when Postgres and Redis are already running locally or are reachable externally.

```bash
set DATABASE_URL=postgresql://user:password@host:5432/database
set REDIS_URL=redis://host:6379
npm run release:prod:gate:external
```

PowerShell:

```powershell
$env:DATABASE_URL="postgresql://user:password@host:5432/database"
$env:REDIS_URL="redis://host:6379"
npm run release:prod:gate:external
```

No Docker command is executed in this mode.

External mode is valid only after real Postgres and Redis healthchecks pass. For `soft-zero-cost` local app development, Redis may be omitted only through the runtime profile policy; release gates still use real Redis unless the specific gate is changed to a soft-launch-only check.

Use a dedicated staging/test Postgres and Redis for release gates. The security gate resets Redis state; for non-local Redis URLs you must explicitly confirm it is isolated:

```bash
set SECURITY_GATE_ALLOW_EXTERNAL_REDIS_FLUSH=true
```

PowerShell:

```powershell
$env:SECURITY_GATE_ALLOW_EXTERNAL_REDIS_FLUSH="true"
```

## Opzione C - Auto

Use this as the default Windows-friendly path. It prefers free/non-Desktop paths and does not use Docker Desktop unless explicitly allowed.

```bash
npm run release:prod:gate:auto
```

Order:

1. Try WSL2 Docker Engine.
2. Try already reachable Postgres/Redis.
3. Fail with explicit remediation instructions.

Optional Desktop fallback for teams that explicitly allow it:

```powershell
$env:ALLOW_DOCKER_DESKTOP_FALLBACK="true"
npm run release:prod:gate:auto
```

## Opzione D - Docker Desktop optional

Use this when Docker Desktop is installed and `docker info` is healthy from PowerShell or CMD.

```bash
npm run release:prod:gate:desktop
```

This runs:

```bash
docker compose up -d postgres redis
```

The gate then performs real Postgres and Redis healthchecks before running tests.

## Notes

- `INFRA_MODE=external` requires both `DATABASE_URL` and `REDIS_URL`.
- `INFRA_MODE=wsl-docker` and `release:prod:gate:free` require a real Docker Engine inside WSL2. If `docker` resolves to `/mnt/wsl/docker-desktop/...` or the daemon reports `Docker Desktop`, the gate fails instead of silently using Desktop.
- Docker Desktop is opt-in only via `INFRA_MODE=docker-desktop` or `ALLOW_DOCKER_DESKTOP_FALLBACK=true`.
- External Redis must be dedicated to the release gate before enabling `SECURITY_GATE_ALLOW_EXTERNAL_REDIS_FLUSH=true`.
- `INFRA_MODE=auto` can use explicit env URLs or the local defaults:
  - `postgresql://flight:flight@127.0.0.1:5432/flight`
  - `redis://127.0.0.1:6379`
- Docker Desktop errors such as `dockerDesktopLinuxEngine`, `500 Internal Server Error`, or daemon unavailable are not blockers if WSL Docker Engine or external services are available.
- A PASS is only valid after real Postgres and Redis healthchecks, security gate, compliance check, and build all pass.
