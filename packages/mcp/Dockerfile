# packages/mcp/Dockerfile
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

# Copy workspace manifests first for better caching. @almanac/api is a
# devDependency of @almanac/mcp (used in tests), so its manifest must be
# present for the install graph to resolve.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/api/package.json ./packages/api/
COPY packages/mcp/package.json ./packages/mcp/

RUN pnpm install --frozen-lockfile --filter @almanac/mcp...

COPY packages/core ./packages/core
COPY packages/api ./packages/api
COPY packages/mcp ./packages/mcp

RUN pnpm --filter @almanac/core build
RUN pnpm --filter @almanac/mcp build

# Stage 2: prod image
FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/core ./packages/core
COPY --from=build /repo/packages/api ./packages/api
COPY --from=build /repo/packages/mcp ./packages/mcp
COPY --from=build /repo/package.json /repo/pnpm-workspace.yaml ./

ENV NODE_ENV=production
ENV ALMANAC_MCP_TRANSPORT=http
ENV ALMANAC_MCP_HOST=0.0.0.0
ENV ALMANAC_MCP_PORT=3030

# Stamped by release.yml from github.sha / github.ref_name. Defaults keep
# locally-built images honest about being unstamped.
ARG GIT_SHA=unknown
ENV ALMANAC_GIT_SHA=$GIT_SHA
ARG GIT_TAG=dev
ENV ALMANAC_GIT_TAG=$GIT_TAG

EXPOSE 3030
ENTRYPOINT ["/usr/bin/tini", "--"]
# --conditions=production selects the dist/*.js branch of @almanac/core's
# exports map; dev/test tooling falls through to the `default` source branch.
CMD ["node", "--conditions=production", "packages/mcp/dist/index.js"]
