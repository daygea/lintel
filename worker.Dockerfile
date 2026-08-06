# Transcode worker for Lintel — turns uploaded audio/video into streamable
# derivatives. Runs `npm run worker`.
#
# This exists as a Docker image (not Render's native Node runtime) for one reason:
# the worker shells out to `ffmpeg`/`ffprobe`, which the base Node image doesn't
# ship. We install them from Debian and let the worker find them on PATH
# (config/env defaults FFMPEG_PATH/FFPROBE_PATH to 'ffmpeg'/'ffprobe').
#
# Deploy as a Render **Background Worker** with runtime "Docker" and this file as
# the Dockerfile path. See WORKER.md.

FROM node:22-bookworm-slim

# ffmpeg pulls in ffprobe too. Drop apt lists to keep the image lean.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first, so this layer caches unless package.json changes.
COPY package*.json ./
RUN npm install

# Only the app source — no local node_modules, no host junk. Keeps the image
# clean and side-steps native-module platform mismatches from a host build.
COPY src ./src

ENV NODE_ENV=production

# The worker connects to Mongo, polls the Job queue, and transcodes. It serves no
# HTTP — Render Background Workers need no port or health check.
CMD ["npm", "run", "worker"]
