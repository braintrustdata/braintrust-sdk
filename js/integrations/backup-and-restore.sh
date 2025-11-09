#!/usr/bin/env bash
set -e

ACTION="${1:-backup}"

DIR="$(pwd)"
PACKAGE_JSON="$DIR/package.json"
BACKUP_JSON="$DIR/package.json.bak"

if [ "$ACTION" = "backup" ]; then
  if [ -f "$PACKAGE_JSON" ]; then
    cp "$PACKAGE_JSON" "$BACKUP_JSON"
    echo "Backed up package.json in $DIR"
  else
    echo "No package.json found in $DIR"
    exit 1
  fi
elif [ "$ACTION" = "restore" ]; then
  if [ -f "$BACKUP_JSON" ]; then
    cp "$BACKUP_JSON" "$PACKAGE_JSON"
    echo "Restored package.json in $DIR"
  else
    echo "No backup found in $DIR"
    exit 1
  fi
else
  echo "Unknown action '$ACTION'. Use 'backup' or 'restore'."
  exit 1
fi
