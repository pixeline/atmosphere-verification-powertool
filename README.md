# Vidi

A full-stack verification tool built with Next.js and Docker.

## First Run

### Environment Setup

1. Copy `.env.example` to `.env` and configure:
   ```bash
   cp .env.example .env
   ```
   Update the following values:
   - `DATABASE_URL`: PostgreSQL connection string
   - `VIDI_PUBLIC_URL`: Public URL of the deployment
   - `VIDI_TOKEN_ENC_KEY`: 32-byte base64 encryption key
   - `VIDI_COOKIE_SECRET`: 32+ character secret
   - `VIDI_SUPERADMIN_DIDS`: Comma-separated list of superadmin DIDs
   - `VIDI_SEED_ALLOWLIST`: (Optional) Comma-separated DIDs to seed into allowlist
   - `VIDI_SEED_KEYWORDS`: (Optional) Comma-separated keywords to seed into crawl
   - `VIDI_OAUTH_PRIVATE_JWK`: OAuth signing key (ES256 JWK format)

2. Run database migrations:
   ```bash
   docker compose run --rm app npx tsx src/db/migrate.ts
   ```

3. Seed initial data (optional, safe to re-run):
   ```bash
   docker compose run --rm app npx tsx scripts/seed.ts
   ```

4. Start the application and owner onboarding:
   - Open the app at your `VIDI_PUBLIC_URL`
   - Navigate to `/vidi`
   - Owner logs in with their ATProto account
   - After authentication, POST to `/vidi/api/org/onboard` to register the organization

## Deployment

### GitHub Secrets

The GitHub Actions deploy pipeline requires the following secrets to be configured:

- `VPS_HOST`: The hostname or IP address of the VPS where the app is deployed
- `VPS_USER`: The SSH username for accessing the VPS
- `VPS_SSH_KEY`: The private SSH key for authentication (typically the contents of an SSH private key file)

### Runtime Configuration

The application runtime configuration is stored in `.env` on the VPS at:

```
/opt/vidi/.env
```

This file should be manually created on the VPS with the required environment variables for the deployed instance.

### Deploy Pipeline

On every push to the `main` branch, the GitHub Actions workflow automatically:

1. Builds a Docker image from the Dockerfile
2. Pushes the image to GitHub Container Registry (`ghcr.io/pixeline/vidi:latest`)
3. Connects to the VPS via SSH and:
   - Pulls the latest Docker image
   - Runs database migrations using `npx tsx src/db/migrate.ts`
   - Starts the application with `docker compose up -d`
