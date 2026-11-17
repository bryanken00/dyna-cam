// pm2 process file for the recorder box: `pm2 start ecosystem.config.cjs`
module.exports = {
  apps: [
    {
      name: "dyna-cam-edge",
      script: "./src/index.js",
      cwd: __dirname,
      watch: false,
      autorestart: true,
      restart_delay: 5000,
      max_memory_restart: "400M",
      // Time for the graceful shutdown to stop every ffmpeg child
      kill_timeout: 15000,
      time: true,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
