#!/bin/bash
#
# This is a very crude script to parallelize nox sessions into groups.
# It's used to run the nox tests in parallel on GitHub Actions.
#
#

set -euo pipefail

ROOT_DIR=$(git rev-parse --show-toplevel)
NOXFILE=$ROOT_DIR/py/noxfile.py

# Parse command line arguments
if [ $# -lt 2 ]; then
  echo "Usage: $0 <shard_index> <number_of_shards> [--dry-run]"
  exit 1
fi

INDEX=$1
TOTAL=$2
DRY_RUN=false
shift 2
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 <shard_index> <number_of_shards> [--dry-run]"
      exit 1
      ;;
  esac
done

if [ "$INDEX" -ge "$TOTAL" ]; then
  echo "Error: shard_index ($INDEX) must be less than number_of_shards ($TOTAL)"
  exit 1
fi

# Nox formats the sessions like:
# * test_foo
# * test_bar
all_sessions=$(nox -l -f $NOXFILE | grep "^\* " | cut -c 3- | sort)
matches=$(echo "$all_sessions" | awk "NR % $TOTAL == $INDEX")
misses=$(echo "$all_sessions" | awk "NR % $TOTAL != $INDEX")
n_matches=$(echo "$matches" | wc -l | xargs)
n_all=$(echo "$all_sessions" | wc -l | xargs)

printf "nox matrix idx:%d shards:%d running %d/%d sessions\n" "$INDEX" "$TOTAL" "$n_matches" "$n_all"

if [ "$DRY_RUN" = true ]; then
  echo "--------------------------------"
  echo "Would run the following sessions:"
  echo "$matches"
  echo ""
  echo "--------------------------------"
  echo "Would skip the following sessions:"
  echo "$misses"
  exit 0
fi

echo "$matches" | xargs nox -f $NOXFILE
