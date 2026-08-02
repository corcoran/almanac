# packages/web/Dockerfile
# Stage 1: build the Vite SPA bundle
FROM node:20-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable pnpm

# @almanac/core depends on better-sqlite3, whose 12.x install script falls back
# to `node-gyp rebuild` when prebuild-install finds no matching prebuilt binary
# for this image. node-gyp needs python3/make/g++ to compile the native addon.
# The compiled binary is discarded with this build stage (the runtime stage is
# nginx serving static files), but the install still has to succeed.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/web/package.json ./packages/web/

RUN pnpm install --frozen-lockfile --filter @almanac/web...

COPY packages/core ./packages/core
COPY packages/web ./packages/web

# vite.config.ts reads CHANGELOG.md (repo root → /repo here) at build time to
# bundle the "What's new" panel. The COPYs above only bring in packages/*, so
# copy it explicitly; a release build FAILS if it's missing (see vite.config.ts).
COPY CHANGELOG.md ./

# Commit the bundle is built from. Passed as a build arg (see
# docker-compose.yml / deploy/update.sh) and handed to Vite via the GIT_SHA
# env, which vite.config.ts compiles into the bundle as __COMMIT__. Defaults
# to "unknown" for un-stamped builds.
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA

# Release tag the bundle is built from (e.g. v1.2.3). Passed as a build arg by
# the release workflow (github.ref_name); defaults to "dev" for non-release
# builds. Handed to Vite via GIT_TAG → __APP_VERSION__.
ARG GIT_TAG=dev
ENV GIT_TAG=$GIT_TAG

# Build core first (web imports @almanac/core types), then web.
RUN pnpm --filter @almanac/core build && pnpm --filter @almanac/web build

# Stage 2: nginx serves the static bundle
FROM nginx:1.27-alpine
COPY --from=build /repo/packages/web/dist /usr/share/nginx/html
COPY packages/web/docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
