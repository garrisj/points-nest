#!/bin/sh
# Runs every test. Usage: sh tests/run.sh [path to a version 1 export]
set -e
cd "$(dirname "$0")"
node model.test.js
node migrate.test.js "$@"
node household.test.js
node background.test.js
