# Deploying the ClaudeRegistry MCP server

The service is a plain Node process on `127.0.0.1:8787`, exposed publicly as the path
`https://clauderegistry.com/mcp` via the existing site's Nginx (no new subdomain, DNS
record, or TLS cert).

## One-time setup on the droplet

```bash
# 1. Clone
sudo git clone git@github.com:onBookmarks/mcp-server.git /opt/clauderegistry-mcp
cd /opt/clauderegistry-mcp
sudo npm ci --omit=dev
sudo chown -R www-data:www-data /opt/clauderegistry-mcp   # match the systemd User=

# 2. systemd service (auto-restart, starts on boot)
sudo cp deploy/clauderegistry-mcp.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now clauderegistry-mcp
curl -fsS http://127.0.0.1:8787/health          # -> {"ok":true}

# 3. Nginx: paste the location block into the EXISTING clauderegistry.com server{}
#    (see deploy/nginx-mcp.conf), then:
sudo nginx -t && sudo systemctl reload nginx

# 4. Verify end-to-end
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://clauderegistry.com/mcp   # 400/406 = reached the server (needs MCP body); NOT 404
```

Then anyone can add it:

```bash
claude mcp add --transport http clauderegistry https://clauderegistry.com/mcp
```

## Updating (manual)

```bash
cd /opt/clauderegistry-mcp
sudo git pull --ff-only origin main
sudo npm ci --omit=dev
sudo systemctl restart clauderegistry-mcp
```

## Updating (automatic, GitHub Actions)

`.github/workflows/deploy.yml` redeploys on push to `main` — but only once you opt in:

1. Repo -> Settings -> Secrets and variables -> Actions:
   - **Variable** `DEPLOY_ENABLED` = `true`
   - **Secrets**: `DEPLOY_HOST` (droplet IP), `DEPLOY_USER` (e.g. `root`), `DEPLOY_PATH` (`/opt/clauderegistry-mcp`), `DEPLOY_SSH_KEY` (a private key whose public key is in the droplet's `~/.ssh/authorized_keys`).
2. For `sudo systemctl restart` to work non-interactively, allow it for the deploy user, e.g. add via `visudo`:
   `deployuser ALL=(root) NOPASSWD: /bin/systemctl restart clauderegistry-mcp`

Until `DEPLOY_ENABLED=true`, the workflow job is skipped (it never fails a push).

## Docker (alternative to systemd)

```bash
docker build -t clauderegistry-mcp .
docker run -d --restart unless-stopped -p 127.0.0.1:8787:8787 --name mcp clauderegistry-mcp
```

## Register (optional, discovery only)

Submit `server.json` (name `com.clauderegistry/plugin-catalog`) to the
[Official MCP Registry](https://github.com/modelcontextprotocol/registry) so agents can
discover the server. The public endpoint works without this.
