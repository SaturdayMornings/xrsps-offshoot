# xRSPS game server image.
#
# Node 22.16+ is required: persistence uses the built-in `node:sqlite` module
# (Node >= 22.5.0) and the root package.json pins `>=22.16.0` in engines.
FROM node:22.16-bookworm-slim

# Yarn 4.12.0 (matching `packageManager` in package.json) is provided by corepack.
# COREPACK_ENABLE_DOWNLOAD_PROMPT keeps the build non-interactive.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

WORKDIR /app

# Dependencies are installed before sources are copied so this layer stays cached.
# The server resolves shared engine code from client/common, client/rs and
# client/custom, but every package those modules need is mirrored in
# server/package.json — so client dev dependencies (react-scripts, etc.) are
# deliberately not installed here.
COPY package.json yarn.lock .yarnrc.yml ./
COPY server/package.json server/yarn.lock server/
RUN yarn install --immutable \
    && yarn --cwd server install --immutable

COPY server ./server
COPY client ./client

# Game WebSocket port (config.port default).
EXPOSE 43594

# `exec` hands PID 1 to tsx so `docker stop` (SIGTERM) reaches the graceful
# shutdown handler in server/src/index.ts, which flushes pending player saves.
CMD ["sh", "-c", "yarn --cwd server ensure-cache && cd server && exec node_modules/.bin/tsx src/index.ts"]
