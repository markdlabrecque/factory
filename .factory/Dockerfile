# Factory agents have Pi, the writing-tests skill, global Playwright and shared non-root Chromium.
FROM node:22-bookworm

# Keep the Pi version already used by the deployed Factory image on rebuild.
RUN npm install -g @earendil-works/pi-coding-agent@1.5.2

# Install system dependencies
RUN apt-get update && apt-get install -y \
  git \
  curl \
  jq \
  && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
  && apt-get update && apt-get install -y gh \
  && rm -rf /var/lib/apt/lists/*

# Install the browser while root; the agent uses this same shared runtime.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
RUN npm install -g playwright@1.65.1 \
  && playwright install --with-deps chromium \
  && chmod -R a+rX /opt/ms-playwright \
  && rm -rf /var/lib/apt/lists/*

# Build-args for UID/GID alignment: sandcastle docker build-image
# defaults these to the host user's UID/GID so image-built files
# and bind-mounted files share an owner without runtime chown.
ARG AGENT_UID=1000
ARG AGENT_GID=1000

# Rename the base image's "node" user to "agent" and align UID/GID.
RUN groupmod -o -g $AGENT_GID node && usermod -o -u $AGENT_UID -g $AGENT_GID -d /home/agent -m -l agent node
# Keep the canonical Agent Skill plus Pi 1.5.2's user-skill discovery path.
COPY --chown=${AGENT_UID}:${AGENT_GID} skills/writing-tests/ /home/agent/.agents/skills/writing-tests/
RUN mkdir -p /home/agent/.pi/agent/skills \
  && ln -s /home/agent/.agents/skills/writing-tests /home/agent/.pi/agent/skills/writing-tests \
  && chown -R ${AGENT_UID}:${AGENT_GID} /home/agent/.pi
USER ${AGENT_UID}:${AGENT_GID}

# Install Claude Code CLI
RUN curl -fsSL https://claude.ai/install.sh | bash

# Add Claude to PATH
ENV PATH="/home/agent/.local/bin:$PATH"

WORKDIR /home/agent

# In worktree sandbox mode, Sandcastle bind-mounts the git worktree at /home/agent/workspace
# and overrides the working directory to /home/agent/workspace at container start.
# Structure your Dockerfile so that /home/agent/workspace can serve as the project root.
ENTRYPOINT ["sleep", "infinity"]
