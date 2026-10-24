#!/bin/sh
# Puts the demo Dragon Gear app back to the same start before each GIF: the made-up settings,
# the app restarted on 127.0.0.1:7317 (no Flav-Toolkit feed), then the made-up game data (feed.py).
H=$(cd "$(dirname "$0")" && pwd)
DEMO=${DEMO:-$H/demo}
pkill -f "node app/server.js"; sleep 0.8
cp "$H/demo-settings.json" "$DEMO/settings.json"
cd "$DEMO" && FLAV_FEED_FILE="$DEMO/no-feed.json" nohup node app/server.js > server.log 2>&1 &
for i in $(seq 1 40); do curl -s -o /dev/null http://127.0.0.1:7317/api/status && break; sleep 0.25; done
python3 "$H/feed.py" all
