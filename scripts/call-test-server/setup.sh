#!/usr/bin/env bash
# Starts a local Nextcloud with Talk and a High-Performance Backend (signaling server, Janus, TURN)
# for testing calls, and creates the users alice, bob and carol. See CONTRIBUTING.md.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  cat > .env <<ENV
TURN_SECRET=$(openssl rand -hex 24)
SIGNALING_SECRET=$(openssl rand -hex 24)
INTERNAL_SECRET=$(openssl rand -hex 24)
ENV
fi
# shellcheck disable=SC1091
. ./.env

docker compose up -d
echo "Waiting for Nextcloud to install…"
until curl -sf http://127.0.0.1:8090/status.php | grep -q '"installed":true'; do sleep 5; done

occ() { docker compose exec -T -u www-data nextcloud php occ "$@"; }
occ app:install spreed >/dev/null 2>&1 || occ app:enable spreed
occ config:system:set allow_local_remote_servers --value=true --type=boolean
occ config:system:set overwrite.cli.url --value=http://127.0.0.1:8090
# Also reachable over https through the proxy, which Nextcloud then has to trust
occ config:system:set trusted_domains 2 --value=127.0.0.1:8443
occ config:system:set trusted_proxies 0 --value=127.0.0.1
occ talk:signaling:list | grep -q 127.0.0.1:8081 || occ talk:signaling:add http://127.0.0.1:8081 "$SIGNALING_SECRET"
occ talk:turn:list | grep -q 127.0.0.1:3478 || occ talk:turn:add turn 127.0.0.1:3478 udp,tcp --secret "$TURN_SECRET"

echo
echo "Nextcloud: http://127.0.0.1:8090, or https://127.0.0.1:8443 in a browser (admin / admin-test-pw)"
for u in alice bob carol; do
  name="$(echo "${u:0:1}" | tr '[:lower:]' '[:upper:]')${u:1} Test"
  docker compose exec -T -e OC_PASS="$u-test-pw" -u www-data nextcloud \
    php occ user:add --password-from-env --display-name="$name" "$u" >/dev/null 2>&1 || true
  # Hubbub signs in with app passwords; a login password breaks the call session (see CONTRIBUTING.md)
  pw=$(docker compose exec -T -e NC_PASS="$u-test-pw" -u www-data nextcloud php occ user:auth-tokens:add --password-from-env "$u" | tail -1)
  echo "  $u  app password: $pw"
done
