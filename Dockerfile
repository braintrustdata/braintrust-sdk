# Development container for braintrust-sdk-javascript
FROM debian:trixie-slim

# Set UTF-8 locale
ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

# Configure UV to use copy mode (expected in Docker with different filesystems)
ENV UV_LINK_MODE=copy

# Install curl, ca-certificates, and git first (needed for install-deps.sh and mise)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    ca-certificates \
    git \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user with configurable UID/GID
ARG UID=1000
ARG GID=1000
RUN groupadd -g $GID dev && useradd -m -u $UID -g $GID dev

# Create directories for mise and bundle cache
RUN mkdir -p /home/dev/.local/share/mise /home/dev/.local/bin \
    && chown -R dev:dev /home/dev

# Switch to non-root user
USER dev
ENV HOME=/home/dev
ENV PATH="/home/dev/.local/bin:$PATH"

# Install mise as the dev user
RUN curl https://mise.run | sh

# Configure git safe.directory for mounted volumes
RUN git config --global --add safe.directory /app

# Activate mise in bash
RUN echo 'eval "$(mise activate bash)"' >> ~/.bashrc

WORKDIR /app

CMD ["bash"]
