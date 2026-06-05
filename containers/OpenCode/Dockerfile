FROM node:24-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir /workspace
WORKDIR /workspace

RUN npm i -g opencode-ai

ENTRYPOINT ["bash", "-c", "opencode"]
CMD []