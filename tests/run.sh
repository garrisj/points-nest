#!/bin/sh
# Runs every test. Usage: sh tests/run.sh
set -e
cd "$(dirname "$0")"
node model.test.js
node fields.test.js
node holdings.test.js
node household.test.js
node background.test.js
node snapshot.test.js
