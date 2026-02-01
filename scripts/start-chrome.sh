#!/bin/bash
# Start Chrome in remote debugging mode for workany

PORT=${1:-9222}
PROFILE_DIR="/tmp/chrome-workany-$PORT"

echo "Starting Chrome with remote debugging on port $PORT..."
echo "Profile directory: $PROFILE_DIR"

# Check if Chrome is already running on this port
if curl -s "http://127.0.0.1:$PORT/json/version" > /dev/null 2>&1; then
    echo "Chrome is already running on port $PORT"
    curl -s "http://127.0.0.1:$PORT/json/version" | grep -E '"Browser"|"webSocketDebuggerUrl"'
    exit 0
fi

# Start Chrome
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
        --remote-debugging-port=$PORT \
        --user-data-dir="$PROFILE_DIR" \
        --no-first-run \
        --no-default-browser-check \
        > /dev/null 2>&1 &
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    google-chrome \
        --remote-debugging-port=$PORT \
        --user-data-dir="$PROFILE_DIR" \
        --no-first-run \
        --no-default-browser-check \
        > /dev/null 2>&1 &
fi

# Wait for Chrome to start
echo "Waiting for Chrome to start..."
for i in {1..10}; do
    if curl -s "http://127.0.0.1:$PORT/json/version" > /dev/null 2>&1; then
        echo "Chrome started successfully!"
        curl -s "http://127.0.0.1:$PORT/json/version" | grep -E '"Browser"|"webSocketDebuggerUrl"'
        exit 0
    fi
    sleep 1
done

echo "Failed to start Chrome or connect to debugging port"
exit 1
