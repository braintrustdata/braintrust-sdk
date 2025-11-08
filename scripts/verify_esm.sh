#!/usr/bin/env bash
node -e '
if (typeof import.meta.url !== "string") {
  console.error("Error: Not running in ESM");
  process.exit(1);
} else {
  console.log("Running in ESM");
}
'
