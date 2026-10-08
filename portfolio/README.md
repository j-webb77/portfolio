# Deployment Guide — Portfolio on Ubuntu 24.04 + Nginx

End-to-end instructions for a fresh Linode running Ubuntu 24.04 LTS.
Everything below is copy-paste ready. Run each block as `root` (or prefix with `sudo`).

---

## 1. System packages

```bash
apt update && apt upgrade -y
apt install -y curl git nginx ufw

# Node.js 20 LTS (current "recommended" LTS for production) via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs build-essential

node -v      # should print v20.x
npm -v
```

## 2. Firewall

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
ufw status
```

## 3. Put the code on the server

Copy the project to `/var/www/portfolio`. From your local machine:

```bash
# Run from the parent folder that contains the project directory
rsync -avz --exclude node_modules --exclude data --exclude .env \
  ./portfolio/ root@YOUR_SERVER_IP:/var/www/portfolio/
```

Or clone from Git directly on the server:

```bash
mkdir -p /var/www
git clone <YOUR_REPO_URL> /var/www/portfolio
```

## 4. Create the service user and permissions

```bash
# Node will run as www-data (already created by nginx)
mkdir -p /var/www/portfolio/data
chown -R www-data:www-data /var/www/portfolio
chmod 750 /var/www/portfolio/data
```

## 5. Install dependencies and configure environment

```bash
cd /var/www/portfolio
npm ci --omit=dev

cp .env.example .env
# Generate a strong session secret:
node -e "console.log('SESSION_SECRET=' + require('crypto').randomBytes(48).toString('hex'))"
```

Edit `.env` and paste the generated secret:

```bash
nano .env
```

A minimal production `.env` looks like:

```
PORT=3000
SESSION_SECRET=<paste the 96-char hex string here>
ADMIN_USER=admin
ADMIN_PASS=pasword123
DB_PATH=./data/portfolio.db
COOKIE_SECURE=false
```

> Leave `COOKIE_SECURE=false` for now — you don't have HTTPS yet.
> Flip it to `true` after step 9.

Initialize the database (creates tables and seeds 6 sample projects + the admin user):

```bash
sudo -u www-data node server/db.js
```

You should see:
```
[db] seeded admin user "admin"
[db] seeded 6 sample projects
[db] ready at /var/www/portfolio/data/portfolio.db
```

## 6. Smoke-test the app locally

```bash
sudo -u www-data node server/server.js &
sleep 1
curl -s http://127.0.0.1:3000/api/projects | head -c 300
echo
curl -s http://127.0.0.1:3000/api/views
kill %1
```

If you see JSON, the app is healthy. Stop it before continuing.

## 7. Install the systemd unit

```bash
cp /var/www/portfolio/deploy/portfolio.service /etc/systemd/system/portfolio.service
systemctl daemon-reload
systemctl enable --now portfolio
systemctl status portfolio --no-pager
```

Follow the logs:

```bash
journalctl -u portfolio -f
```

## 8. Configure Nginx

```bash
cp /var/www/portfolio/deploy/nginx.conf /etc/nginx/sites-available/portfolio
ln -sf /etc/nginx/sites-available/portfolio /etc/nginx/sites-enabled/portfolio
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl reload nginx
```

Visit `http://YOUR_SERVER_IP/` — the site should load.
Visit `http://YOUR_SERVER_IP/admin` — sign in with `admin` / `pasword123`.

**Change the admin password immediately** by opening the SQLite shell:

```bash
sudo -u www-data sqlite3 /var/www/portfolio/data/portfolio.db
```

Then inside the shell:

```sql
-- Replace 'newStrongPassword' and re-run:
DELETE FROM admins;
-- (Then exit and re-run `node server/db.js` after updating ADMIN_PASS in .env,
--  or generate a hash directly:)
```

The simplest safe rotation is:

```bash
# 1. Update ADMIN_PASS in .env to your new password
nano /var/www/portfolio/.env
# 2. Delete the seeded admin row
sudo -u www-data sqlite3 /var/www/portfolio/data/portfolio.db "DELETE FROM admins;"
# 3. Restart the service so the seeder runs with the new password
systemctl restart portfolio
```

## 9. Add a domain and HTTPS (once you own one)

Point an `A` record at your Linode's IP, then:

```bash
apt install -y certbot python3-certbot-nginx

# Edit the nginx vhost: replace every `server_name _;` with your domain
nano /etc/nginx/sites-available/portfolio

nginx -t && systemctl reload nginx

# Issue and install the certificate, auto-configuring HTTPS + redirect
certbot --nginx -d yourdomain.com -d www.yourdomain.com

# Enable the Secure flag on the session cookie
sed -i 's/^COOKIE_SECURE=.*/COOKIE_SECURE=true/' /var/www/portfolio/.env
systemctl restart portfolio
```

Certbot installs a systemd timer that renews certificates automatically. Verify with:

```bash
systemctl list-timers | grep certbot
```

## 10. Operating the service

```bash
systemctl status portfolio      # current status
systemctl restart portfolio     # restart after code changes
systemctl stop portfolio        # stop
journalctl -u portfolio -n 100  # last 100 log lines
journalctl -u portfolio -f      # live tail
```

## 11. Deploying updates

```bash
cd /var/www/portfolio
sudo -u www-data git pull            # or rsync from your machine
sudo -u www-data npm ci --omit=dev   # only if dependencies changed
systemctl restart portfolio
```

## 12. Backups

The entire application state lives in one file:

```bash
# Manual backup
sudo -u www-data sqlite3 /var/www/portfolio/data/portfolio.db ".backup '/root/portfolio-$(date +%F).db'"

# Nightly cron (edit with: crontab -e, run as root)
0 3 * * * sqlite3 /var/www/portfolio/data/portfolio.db ".backup '/root/backups/portfolio-$(date +\%F).db'" && find /root/backups -name 'portfolio-*.db' -mtime +14 -delete
```

Create the backup directory first:

```bash
mkdir -p /root/backups
```

## 13. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `502 Bad Gateway` from nginx | Node isn't listening on 127.0.0.1:3000 | `systemctl status portfolio` and `journalctl -u portfolio -n 50` |
| `EADDRINUSE` in logs | Something else on port 3000 | `ss -ltnp \| grep 3000`, then change `PORT` in `.env` |
| `SQLITE_CANTOPEN` | `data/` not writable by www-data | `chown -R www-data:www-data /var/www/portfolio/data` |
| Login doesn't persist | Cookie blocked | Confirm `COOKIE_SECURE` matches your scheme (false on HTTP, true on HTTPS) |
| `better-sqlite3` build error during `npm ci` | Missing build tools | `apt install -y build-essential python3` then re-run `npm ci` |
| Blank page after deploy | nginx `root` path wrong | `ls /var/www/portfolio/public/index.html` and confirm `root` in the vhost |

## 14. Customizing the site

All six projects are seeded into SQLite. Replace them either:

- **Through the admin panel** at `https://yourdomain.com/admin` (recommended), or
- **Directly in the seed data** in `server/db.js`, then reset the DB:

```bash
sudo -u www-data node server/db.js --reset
systemctl restart portfolio
```

The name, bio, and social links live in `public/index.html`. The monogram initials appear
in two places: the `<span class="monogram">` in the header, and the SVG data URI in
the `<link rel="icon">` tag.

Drop a PDF résumé at `public/assets/resume.pdf` so the "Résumé" button resolves.

---

**You should now be live at `http://YOUR_SERVER_IP/` with the admin at `/admin`.**

Total footprint on disk: about 15 MB with `node_modules`, well under 1 MB