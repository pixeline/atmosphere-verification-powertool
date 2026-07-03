# Vidi

A full-stack verification tool built with Next.js and Docker.

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
