#!/bin/sh
set -eu
BASE=/etc/letsencrypt-bangla
chgrp caddy "$BASE" "$BASE/live" "$BASE/archive" "$BASE/live/bangla-ip" "$BASE/archive/bangla-ip"
chmod 0750 "$BASE" "$BASE/live" "$BASE/archive" "$BASE/live/bangla-ip" "$BASE/archive/bangla-ip"
chgrp caddy "$BASE"/archive/bangla-ip/privkey*.pem
chmod 0640 "$BASE"/archive/bangla-ip/privkey*.pem
/usr/bin/caddy validate --config /etc/caddy/Caddyfile
/usr/bin/systemctl reload caddy
