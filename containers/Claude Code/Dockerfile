FROM node:24-bookworm-slim

RUN mkdir /workspace
WORKDIR /workspace

RUN npm i -g @anthropic-ai/claude-code

COPY env.sh /tmp
RUN chmod +x /tmp/env.sh

ENTRYPOINT ["bash", "-c", "source /tmp/env.sh && rm -f /tmp/env.sh && claude"]
CMD []
