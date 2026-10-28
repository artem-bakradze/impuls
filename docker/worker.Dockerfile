# Worker image: runs the TypeScript sources with tsx, as `pnpm --filter @impuls/worker start` does locally.
# Build from the repository root:
#   docker build -f docker/worker.Dockerfile -t impuls-worker .
FROM node:24-alpine
ENV COREPACK_HOME=/opt/corepack
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile && corepack install && chmod -R a+rX /opt/corepack
USER node
CMD ["pnpm", "--filter", "@impuls/worker", "start"]
