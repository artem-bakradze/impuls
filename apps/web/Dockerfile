# Web image (Next.js standalone). Build from the repository root:
#   docker build -f apps/web/Dockerfile -t impuls-web .
FROM node:24-alpine AS build
ENV COREPACK_HOME=/opt/corepack
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @impuls/web build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
# Required configuration is validated at startup; the container exits if anything is missing.
CMD ["node", "apps/web/server.js"]
