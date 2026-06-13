# Placeholder Dockerfile — real multi-stage build lands in PR 9 (Deployment).
# For now this just keeps `docker compose up` from failing on the build context.

FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* .npmrc* ./
CMD ["echo", "athlos api — real image built in PR 9"]
