#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Docker container label
DOCKER_LABEL="braintrust-sdk"

COMMAND="${1:-}"

usage() {
    cat << EOF
Usage: $0 <command> [options]

Commands:
    create      Create a new container for a branch
    connect     Connect to an existing container
    list        List all containers
    delete      Delete a container
    delete-all  Delete all containers

Examples:
    $0 create matt/new-feature
    $0 list
    $0 connect <container-name>
    $0 delete <container-name>
    $0 delete-all
EOF
    exit 0
}

# ============================================================================
# INIT SCRIPT (embedded, written to temp file when creating containers)
# ============================================================================
generate_init_script() {
    cat << 'INIT_EOF'
#!/bin/bash
set -euo pipefail

echo "Initializing environment..."

# Step 1: Install Claude settings for plan mode
mkdir -p ~/.claude
cat > ~/.claude/settings.json << 'EOF'
{
  "allowUnsandboxedCommands": true,
  "defaultMode": "plan"
}
EOF

# Clear any existing Claude auth to avoid conflicts with ANTHROPIC_API_KEY
claude /logout > /dev/null 2>&1 || true

# Update Claude to latest version
echo "Updating Claude..."
sudo npm install -g @anthropic-ai/claude-code@latest

# Add Braintrust MCP server
echo "Adding Braintrust MCP server..."
claude mcp add --transport http braintrust https://api.braintrust.dev/mcp

echo "Claude settings installed (plan mode enabled with Braintrust MCP)"

# Step 2: Clone repo and create feature branch
if [ -n "${REPO_URL:-}" ]; then
    # Configure git to use GITHUB_TOKEN for HTTPS authentication
    if [ -n "${GITHUB_TOKEN:-}" ]; then
        git config --global credential.helper store
        echo "https://oauth2:${GITHUB_TOKEN}@github.com" > ~/.git-credentials
    fi

    echo "Cloning repository: $REPO_URL"
    git clone "$REPO_URL" /workspace/repo

    cd /workspace/repo

    # Check if base branch exists
    if ! git rev-parse --verify "origin/$BASE_BRANCH" >/dev/null 2>&1; then
        echo "Error: Base branch 'origin/$BASE_BRANCH' does not exist"
        echo "Available branches:"
        git branch -r | head -10
        exit 1
    fi

    echo "Creating feature branch: $FEATURE_BRANCH from $BASE_BRANCH"
    git checkout -b "$FEATURE_BRANCH" "origin/$BASE_BRANCH"

    echo "Repository ready at /workspace/repo"
fi

# Step 3: Install build dependencies
echo "Installing build dependencies..."
sudo apt-get update -qq
sudo apt-get install -y -qq build-essential

# Step 4: Install mise and tools
if [ -d "/workspace/repo" ]; then
    cd /workspace/repo

    echo "Installing mise..."
    curl https://mise.run | sh
    export PATH="$HOME/.local/bin:$PATH"

    echo "Installing tools via mise..."
    mise trust
    mise install

    # Activate mise for this shell
    eval "$(mise activate bash)"

    # Create activation script for interactive shells (.bashrc)
    cat >> ~/.bashrc << 'EOFBASH'
export PATH="$HOME/.local/bin:$PATH"
eval "$(mise activate bash)"
EOFBASH

    # Also add to .profile for login shells
    cat >> ~/.profile << 'EOFPROFILE'
export PATH="$HOME/.local/bin:$PATH"
eval "$(mise activate bash)"
EOFPROFILE

    echo "Tools installed"
    echo "  node:   $(node --version)"
    echo "  pnpm:   $(pnpm --version)"
    echo "  python: $(python --version)"

    # Python SDK setup
    echo ""
    echo "Setting up Python SDK..."
    cd /workspace/repo/py
    make install-dev

    # TypeScript SDK setup
    echo ""
    echo "Setting up TypeScript SDK..."
    cd /workspace/repo/js
    pnpm install

    # Return to repo root
    cd /workspace/repo

    echo ""
    echo "============================================"
    echo "Development environment ready!"
    echo "============================================"
    echo ""
    echo "Python SDK: cd py"
    echo "  make test-core    - Run core tests"
    echo "  make build        - Build package"
    echo "  make install-optional - Install optional deps (anthropic, openai, etc.)"
    echo ""
    echo "TypeScript SDK: cd js"
    echo "  pnpm test         - Run core tests"
    echo "  pnpm build        - Build package"
    echo "  make install-optional-deps - Install optional deps"
    echo ""
fi

echo "Initialization complete"
INIT_EOF
}

# ============================================================================
# COMMANDS
# ============================================================================

cmd_create() {
    local BASE_BRANCH="main"
    local BRANCH_NAME=""

    # Parse create arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --base-branch)
                BASE_BRANCH="$2"
                shift 2
                ;;
            *)
                BRANCH_NAME="$1"
                shift
                ;;
        esac
    done

    if [ -z "$BRANCH_NAME" ]; then
        echo "Usage: $0 create [--base-branch BRANCH] <branch-name>"
        exit 1
    fi

    # Get repo URL and convert to HTTPS
    local REPO_URL=$(cd "$REPO_ROOT" && git remote get-url origin)
    # Handle multiple SSH URL formats:
    #   git@github.com:org/repo.git -> https://github.com/org/repo.git
    #   ssh://git@github.com/org/repo.git -> https://github.com/org/repo.git
    local HTTPS_REPO_URL=$(echo "$REPO_URL" | sed -e 's|^ssh://git@github.com/|https://github.com/|' -e 's|^git@github.com:|https://github.com/|')

    local FEATURE_BRANCH="$BRANCH_NAME"

    # Sanitize branch name for container name
    local CONTAINER_NAME="sdk-$(echo "$FEATURE_BRANCH" | sed 's|/|-|g')"

    echo "Creating container: $CONTAINER_NAME"
    echo "Repo: $HTTPS_REPO_URL"
    echo "Base branch: $BASE_BRANCH"
    echo "Feature branch: $FEATURE_BRANCH"
    echo ""

    # Check if container already exists
    if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        echo "Container already exists: $CONTAINER_NAME"
        echo "Use '$0 connect $FEATURE_BRANCH' to reconnect"
        echo "Or '$0 delete $FEATURE_BRANCH' to remove it first"
        exit 1
    fi

    # Load ALL keys from .env file if it exists
    local ENV_ARGS=()
    local ENV_FILE="$REPO_ROOT/.env"

    if [ -f "$ENV_FILE" ]; then
        echo "Loading environment from .env file..."

        while IFS='=' read -r key value; do
            [[ $key =~ ^#.*$ ]] && continue
            [[ -z $key ]] && continue

            key=$(echo "$key" | xargs)
            value=$(echo "$value" | xargs | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")

            if [ -n "$value" ]; then
                ENV_ARGS+=("-e" "$key=$value")
                echo "  $key"
            fi
        done < "$ENV_FILE"
        echo ""
    fi

    # Set git config if not in env
    if [ -z "${GIT_AUTHOR_NAME:-}" ]; then
        local GIT_AUTHOR_NAME=$(git config user.name || echo "Claude")
        ENV_ARGS+=("-e" "GIT_AUTHOR_NAME=$GIT_AUTHOR_NAME")
    fi

    if [ -z "${GIT_AUTHOR_EMAIL:-}" ]; then
        local GIT_AUTHOR_EMAIL=$(git config user.email || echo "claude@anthropic.com")
        ENV_ARGS+=("-e" "GIT_AUTHOR_EMAIL=$GIT_AUTHOR_EMAIL")
    fi

    echo "Running Docker container..."
    echo ""

    # Create temp workspace for init script
    local TEMP_WORKSPACE=$(mktemp -d)
    generate_init_script > "$TEMP_WORKSPACE/init.sh"
    chmod +x "$TEMP_WORKSPACE/init.sh"

    # Run docker container in background (no --rm so it persists)
    echo "Initializing container in background..."
    docker run -d \
        --name "$CONTAINER_NAME" \
        --label "${DOCKER_LABEL}=true" \
        --label "branch=$FEATURE_BRANCH" \
        -v "$TEMP_WORKSPACE:/workspace" \
        "${ENV_ARGS[@]}" \
        -e "REPO_URL=$HTTPS_REPO_URL" \
        -e "BASE_BRANCH=$BASE_BRANCH" \
        -e "FEATURE_BRANCH=$FEATURE_BRANCH" \
        -w /workspace \
        docker/sandbox-templates:claude-code \
        tail -f /dev/null

    # Wait for container to be running
    sleep 2

    # Run init script
    echo "Running initialization..."
    docker exec "$CONTAINER_NAME" bash /workspace/init.sh

    # Show instructions
    echo ""
    echo "Container created: $CONTAINER_NAME"
    echo ""
    echo "Connect with:"
    echo "  $0 connect $CONTAINER_NAME"
    echo ""
}

cmd_connect() {
    local CONTAINER_NAME="${1:-}"

    if [ -z "$CONTAINER_NAME" ]; then
        echo "Usage: $0 connect <container-name>"
        echo ""
        echo "Available containers:"
        docker ps -a --filter "label=${DOCKER_LABEL}=true" --format "  {{.Names}}"
        exit 1
    fi

    echo "Connecting to container: $CONTAINER_NAME"

    if ! docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        echo "Container not found: $CONTAINER_NAME"
        echo "Use '$0 list' to see available containers"
        exit 1
    fi

    # Check if container is running
    if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        echo "Starting stopped container..."
        docker start "$CONTAINER_NAME"
    fi

    # Execute bash in the container, starting in the repo directory
    echo "Connecting to container..."
    echo ""
    echo "To update Claude:"
    echo "  claude /update"
    echo ""
    echo "To run Claude in unsafe mode:"
    echo "  claude --dangerously-skip-permissions"
    echo ""
    docker exec -it -w /workspace/repo "$CONTAINER_NAME" bash
}

cmd_list() {
    echo "SDK containers:"
    echo ""

    docker ps -a --filter "label=${DOCKER_LABEL}=true" --format "table {{.Names}}\t{{.Status}}\t{{.CreatedAt}}" | head -20

    if [ $(docker ps -a --filter "label=${DOCKER_LABEL}=true" -q | wc -l) -eq 0 ]; then
        echo "No containers found"
    fi
}

cmd_delete() {
    local CONTAINER_NAME="${1:-}"

    if [ -z "$CONTAINER_NAME" ]; then
        echo "Usage: $0 delete <container-name>"
        echo ""
        echo "Available containers:"
        docker ps -a --filter "label=${DOCKER_LABEL}=true" --format "  {{.Names}}"
        exit 1
    fi

    echo "Deleting container: $CONTAINER_NAME"

    if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        docker rm -f "$CONTAINER_NAME"
        echo "Deleted container: $CONTAINER_NAME"
    else
        echo "Container not found: $CONTAINER_NAME"
        exit 1
    fi
}

cmd_delete_all() {
    local CONTAINERS=$(docker ps -a --filter "label=${DOCKER_LABEL}=true" --format "{{.Names}}")

    if [ -z "$CONTAINERS" ]; then
        echo "No containers found"
        exit 0
    fi

    echo "Found containers:"
    echo "$CONTAINERS" | sed 's/^/  /'
    echo ""

    read -p "Delete all containers? [y/N] " -n 1 -r
    echo

    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Cancelled"
        exit 0
    fi

    echo "Deleting all containers..."
    docker ps -a --filter "label=${DOCKER_LABEL}=true" -q | xargs -r docker rm -f

    echo "All containers deleted"
}

# ============================================================================
# MAIN
# ============================================================================

if [ -z "$COMMAND" ]; then
    usage
fi

shift  # Remove command from args

case $COMMAND in
    create)
        cmd_create "$@"
        ;;
    connect)
        cmd_connect "$@"
        ;;
    list)
        cmd_list
        ;;
    delete)
        cmd_delete "$@"
        ;;
    delete-all)
        cmd_delete_all
        ;;
    -h|--help|help)
        usage
        ;;
    *)
        echo "Unknown command: $COMMAND"
        usage
        ;;
esac
