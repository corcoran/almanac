# packages/api/Dockerfile
# Stage 1: workspace install + typecheck-build
FROM node:20-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable pnpm

# better-sqlite3 12.x runs `node-gyp rebuild` when prebuild-install finds no
# matching prebuilt for this image; node-gyp needs python3/make/g++ to compile
# the native addon. The compiled binary travels into the runtime stage via the
# copied node_modules.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Copy workspace manifests + base tsconfig (extended by per-package tsconfigs).
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/api/package.json ./packages/api/

# `...` suffix pulls @almanac/core (workspace dependency) along with @almanac/api.
RUN pnpm install --frozen-lockfile --filter @almanac/api...

# Copy source for core + api packages
COPY packages/core ./packages/core
COPY packages/api ./packages/api

# Build core first (api depends on it), then api. Both packages emit dist/.
# @almanac/core's exports map has an `import` condition pointing at dist/*.js,
# so production `node` resolves to compiled output (no tsx loader needed).
RUN pnpm --filter @almanac/core build
RUN pnpm --filter @almanac/api build

# Stage 2: prod image
FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Copy the resolved node_modules + sources from stage 1.
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/core ./packages/core
COPY --from=build /repo/packages/api ./packages/api
COPY --from=build /repo/package.json /repo/pnpm-workspace.yaml ./

ENV NODE_ENV=production
ENV ALMANAC_DB_PATH=/data/almanac.sqlite
ENV ALMANAC_API_HOST=0.0.0.0
ENV ALMANAC_API_PORT=3001

# Commit the image was built from, surfaced by /v1/health. Passed as a build
# arg (see docker-compose.yml / deploy/update.sh) and baked into the runtime
# env so version.ts can read it. Defaults to "unknown" for un-stamped builds.
ARG GIT_SHA=unknown
ENV ALMANAC_GIT_SHA=$GIT_SHA

# Release tag the image was built from (e.g. v1.2.3), used to name
# pre-migration DB backups. Passed by the release workflow
# (GIT_TAG=${{ github.ref_name }}); defaults to "dev" for un-tagged builds.
ARG GIT_TAG=dev
ENV ALMANAC_GIT_TAG=$GIT_TAG

EXPOSE 3001
ENTRYPOINT ["/usr/bin/tini", "--"]
# --conditions=production selects the dist/*.js branch of @almanac/core's
# exports map; dev/test tooling falls through to the `default` source branch.
CMD ["node", "--conditions=production", "packages/api/dist/index.js"]
