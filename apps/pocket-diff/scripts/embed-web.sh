#!/bin/sh
set -eu

source_directory="../web/dist"
destination_directory="internal/web/dist"

if [ ! -f "$source_directory/index.html" ]; then
  echo "Web build not found. Run pnpm --filter @pocket-diff/web build first." >&2
  exit 1
fi

rm -rf "$destination_directory"
mkdir -p "$destination_directory"
cp -R "$source_directory/." "$destination_directory/"
