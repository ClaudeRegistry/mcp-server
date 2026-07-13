module.exports = {
  apps: [
    {
      name: "clauderegistry-mcp",
      script: "src/index.js",
      cwd: "/var/www/clauderegistry-mcp",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      env: {
        NODE_ENV: "production",
        PORT: "8787",
      },
      error_file: "/var/log/pm2-clauderegistry-mcp-error.log",
      out_file: "/var/log/pm2-clauderegistry-mcp-out.log",
      time: true,
      max_memory_restart: "256M",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm Z",
      restart_delay: 3000,
      min_uptime: 10000,
    },
  ],
};
