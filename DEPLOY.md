# Deploying the ClaudeRegistry MCP server

Runs under **pm2** at `/var/www/clauderegistry-mcp`, listening on `127.0.0.1:8787`,
and exposed publicly as the path `https://clauderegistry.com/mcp` via the existing
site's Nginx (no new subdomain, DNS record, or TLS cert). This matches the
onBookmarks `service` convention (pm2 + `.infra/deploy.sh`).

## One-time setup on the droplet

```bash
# 1. Clone to the standard path
sudo git clone git@github.com:onBookmarks/mcp-server.git /var/www/clauderegistry-mcp
cd /var/www/clauderegistry-mcp
npm ci --omit=dev

# 2. Start under pm2
pm2 start ecosystem.config.js
pm2 save                                    # persist across reboots
curl -fsS http://127.0.0.1:8787/health      # -> {"ok":true}

# 3. Nginx: paste the `location = /mcp` block from
#    .infra/nginx/clauderegistry.com.mcp-location.conf into the EXISTING
#    clauderegistry.com server{} block, then:
sudo nginx -t && sudo systemctl reload nginx

# 4. Verify
curl -s -o /dev/null -w '%{http_code}\n' https://clauderegistry.com/mcp   # 405 for GET (not 404)
```

Then anyone can add it:

```bash
claude mcp add --transport http clauderegistry https://clauderegistry.com/mcp
```

## Deploying updates

After pushing to `main`, from your laptop:

```bash
./.infra/deploy.sh
# or, from the ClaudeRegistry root:
./deploy.sh mcp-server
```

This SSHes to the droplet, `git pull`s, runs `npm ci --omit=dev`, `pm2 reload`s, and health-checks.

## Docker (alternative to pm2)

```bash
docker build -t clauderegistry-mcp .
docker run -d --restart unless-stopped -p 127.0.0.1:8787:8787 --name mcp clauderegistry-mcp
```

## Register (optional, discovery only)

Submit `server.json` (name `com.clauderegistry/plugin-catalog`) to the
[Official MCP Registry](https://github.com/modelcontextprotocol/registry) so agents can
discover the server. The public endpoint works without this.
