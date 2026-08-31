# Balkan Medical Journal — PHP Admin Panel

PHP 8 + MySQL reimplementation of the former Node/Express admin (`../admin`).
The **public site stays static** — this backend regenerates the same
`js/data/*` files the public pages already read. MySQL is the source of truth.

> Production target: **cPanel/Plesk shared hosting** (Apache + PHP 8 + MySQL).
> Docker here is for **local development/verification only**.

## Layout

```
admin-php/
  public/        web root (served as /yonetim): admin UI + api.php front controller + .htaccess
  src/           app code (outside web root): Db, Auth, Router, Repo/, Export/, Import/, routes.php
  cli/           init-db.php (schema + seed), migrate.php (flat files -> MySQL)
  schema.sql     MySQL DDL
  config.php     local secrets (gitignored) — copy from config.sample.php
  docker/        local-only Apache+PHP image
```

## Local development (Docker)

```bash
cd admin-php
docker compose up -d --build
# initialise schema + seed the admin user from ../admin/auth-config.json
docker compose exec web php /var/www/html/admin-php/cli/init-db.php
```

- Admin panel: <http://localhost:8088/yonetim/login>
- Public site:  <http://localhost:8088/>
- MySQL is exposed on host port **3307** (user/pass `balkanmedj`).

Default credentials come from `../admin/auth-config.json` (the existing admin
login). Change them in-panel (Settings → password) once migrated.

## Deployment (cPanel)

1. Create a MySQL database + user in cPanel; import `schema.sql` via phpMyAdmin.
2. Upload the repo. Put `admin-php/public`'s contents where the panel should
   live — e.g. `public_html/yonetim/` — and `admin-php/src`, `cli`, `config.php`
   **outside** the web root or in a directory without direct access.
3. Copy `config.sample.php` to `config.php`; set DB credentials, `project_root`
   (absolute path to the public-site root), `base_path` (`/yonetim` or `''`),
   `site_base_url`, and `is_prod => true`.
4. Set `window.__BASE__` in `public/index.html` and `public/login.html` to match
   `base_path`.
5. Add a rewrite so the panel's `/site/*` previews resolve to the public site
   root (see `docker/vhost.conf` for the equivalent rule).
6. Run `php cli/init-db.php` (or import `schema.sql`) then `php cli/migrate.php`
   once to load existing content into MySQL.
7. Raise `upload_max_filesize` / `post_max_size` (issue PDFs can be large).

## Required PHP extensions

`pdo_mysql`, `zip`, `dom`/`xml`, `mbstring`, `gd` (figure/cover handling).
