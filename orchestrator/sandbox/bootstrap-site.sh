#!/usr/bin/env bash
# Runs in the sandbox after start-web.sh: installs a throwaway Drupal site from config (mirrors the CI e2e job).
set -euo pipefail
cd /home/agent/workspace

# settings.local.php is gitignored (web/sites/*/settings.*.php): reuse the CI settings, pointed at the local DB.
cat > web/sites/default/settings.local.php <<'PHP'
<?php
putenv('MARIADB_DATABASE=app');
putenv('MARIADB_USER=app');
putenv('MARIADB_PASSWORD=app');
include __DIR__ . '/settings.ci.php';
$databases['default']['default']['host'] = '127.0.0.1';
PHP

vendor/bin/drush site:install --existing-config -y
vendor/bin/drush ih-sal:seed-delivery-types
vendor/bin/drush ih-sal:scaffold
chmod -R 777 web/sites/default/files

for _ in $(seq 1 30); do curl -sf http://127.0.0.1/user/login >/dev/null && break; sleep 1; done
curl -sf http://127.0.0.1/user/login >/dev/null || { echo "site did not come up" >&2; exit 1; }
echo "site ready at http://127.0.0.1 (synthetic data only; admin login: vendor/bin/drush uli)"
