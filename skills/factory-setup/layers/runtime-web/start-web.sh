#!/usr/bin/env bash
# Starts MariaDB, PHP-FPM and Apache inside the sandbox. Run as root (sandbox hook with sudo: true).
# Usage: start-web.sh <docroot>   (docroot defaults to the repo's web/ or current dir)
set -euo pipefail
DOCROOT="${1:-$PWD/web}"
[ -d "$DOCROOT" ] || DOCROOT="$PWD"
PHPV="$(ls /etc/php | sort -V | tail -1)"

service mariadb start >/dev/null 2>&1 || (mysqld_safe --skip-networking=0 >/dev/null 2>&1 &)
for _ in $(seq 1 30); do mysqladmin ping --silent 2>/dev/null && break; sleep 1; done
mysql -e "CREATE DATABASE IF NOT EXISTS app; CREATE USER IF NOT EXISTS 'app'@'localhost' IDENTIFIED BY 'app'; GRANT ALL ON app.* TO 'app'@'localhost';"

mkdir -p /run/php
service "php${PHPV}-fpm" start >/dev/null 2>&1

sed -i "s#DocumentRoot .*#DocumentRoot ${DOCROOT}#" /etc/apache2/sites-available/000-default.conf
printf '<Directory %s>\n  AllowOverride All\n  Require all granted\n</Directory>\n' "$DOCROOT" > /etc/apache2/conf-available/docroot.conf
a2enconf docroot >/dev/null
service apache2 start >/dev/null 2>&1
echo "web ready: http://localhost (docroot $DOCROOT, db app/app/app)"
