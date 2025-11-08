#!/usr/bin/env bash
node -e '
if (typeof require === "undefined") {
  console.error("Error: Not running in CommonJS");
  process.exit(1);
} else {
  console.log("Running in CommonJS");
}
'
