#!/bin/bash

set -e

LOCAL_DIST="./dist"
DEPLOY_BRANCH="main"

case "$1" in
    --dev)
        ENV_NAME="dev"
        ;;
    --prod)
        ENV_NAME="prod"
        ;;
    *)
        echo "Usage: $0 [--dev|--prod]"
        exit 1
        ;;
esac

cd "$(dirname "${BASH_SOURCE[0]}")"

# Deploy targets live in .env (REMOTE_DIR_DEV, REMOTE_DIR_PROD, ...), not in this file
env_get() {
    grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}
SUFFIX="$(echo "$ENV_NAME" | tr '[:lower:]' '[:upper:]')"
DEPLOY_HOST="$(env_get DEPLOY_HOST)"
DEPLOY_HOST="${DEPLOY_HOST:-office}"
REMOTE_DIR="$(env_get "REMOTE_DIR_$SUFFIX")"
if [ -z "$REMOTE_DIR" ]; then
    echo "❌ No server set for --$ENV_NAME. Set REMOTE_DIR_$SUFFIX in front/.env."
    exit 1
fi

# Pre-flight (PLAN-010): only committed, reviewed code goes out
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" != "$DEPLOY_BRANCH" ]; then
    echo "❌ On branch '$BRANCH'. Deploy only from '$DEPLOY_BRANCH'."
    exit 1
fi
if [ -n "$(git status --porcelain -- . ':!deploy-logs')" ]; then
    echo "❌ Uncommitted changes. Commit or stash them first:"
    git status --short -- . ':!deploy-logs'
    exit 1
fi
COMMIT="$(git rev-parse HEAD)"

# Commits since the last deploy to this environment (only ones touching front/)
LAST="$(ssh "$DEPLOY_HOST" "cat $REMOTE_DIR/DEPLOYED 2>/dev/null" | awk '{print $1}')"
if [ -n "$LAST" ] && git cat-file -e "$LAST^{commit}" 2>/dev/null; then
    CHANGES="$(git log --format='  %h %ad %s' --date=short "$LAST..$COMMIT" -- .)"
    [ -n "$CHANGES" ] || CHANGES="  (no changes since last deploy)"
elif [ -n "$LAST" ]; then
    CHANGES="  (last deployed commit $LAST not found locally)"
else
    CHANGES="  (first recorded deploy)"
fi
echo "📝 Changes since last $ENV_NAME deploy (${LAST:0:7}):"
echo "$CHANGES"

echo "🔍 Lint..."
npm run lint

echo "🏗️ Building project..."
npm run build

# Ensure the build output exists
if [ ! -d "$LOCAL_DIST" ]; then
    echo "❌ Build failed: '$LOCAL_DIST' not found."
    exit 1
fi

echo "📤 Deploying $COMMIT to: $REMOTE_DIR"

scp -r "$LOCAL_DIST" "$DEPLOY_HOST":"$REMOTE_DIR/"

# Record what is running, for the audit trail of changes
ssh "$DEPLOY_HOST" "cd $REMOTE_DIR && printf '%s %s %s\n' '$COMMIT' \"\$(date -u +%Y-%m-%dT%H:%M:%SZ)\" '$(git config user.email)' > DEPLOYED && cat DEPLOYED >> deploy-history.log"

# Local deploy log: one file per successful deploy, e.g. "dev-10-30-2026-1032PM.log"
mkdir -p deploy-logs
LOG_FILE="deploy-logs/$ENV_NAME-$(date '+%m-%d-%Y-%I%M%p').log"
n=2
while [ -e "$LOG_FILE" ]; do
    LOG_FILE="deploy-logs/$ENV_NAME-$(date '+%m-%d-%Y-%I%M%p')-$n.log"
    n=$((n + 1))
done
{
    echo "Environment: $ENV_NAME"
    echo "Date:        $(date '+%Y-%m-%d %H:%M:%S %z')"
    echo "Commit:      $COMMIT"
    echo "Previous:    ${LAST:-none}"
    echo "By:          $(git config user.email)"
    echo
    echo "Commits since last deploy:"
    echo "$CHANGES"
} > "$LOG_FILE"

echo "✅ Deployment complete! ($COMMIT) — logged to $LOG_FILE"
