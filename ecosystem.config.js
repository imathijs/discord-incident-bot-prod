module.exports = {
  apps: [
    {
      name: 'discord-bot-dre-prod',
      script: 'index.js',
      cwd: '/opt/app-discord-dre',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
