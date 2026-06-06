FROM node:24-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir /workspace
WORKDIR /workspace

RUN npm i -g @anthropic-ai/claude-code

COPY env.sh /tmp
RUN chmod +x /tmp/env.sh && echo '{"hasCompletedOnboarding": true}' > ~/.claude.json

ENTRYPOINT ["bash", "-c", "source /tmp/env.sh && rm -f /tmp/env.sh && claude"]
CMD []
