import { Client, Webhook } from '@structures';
import config from '@config';

Client.initialize();

if (config.errors.catch) {
  process.on('uncaughtException', (error, origin) => {
    Webhook.send(config.errors.webhook, {
      content: [
        '**An error occured inside discord-twitter-forward**',
        '',
        `Origin: \`${origin ?? 'Unknown'}\``,
        `Cause: \`${error.cause ?? 'Unknown'}\``,
        `Type: \`${error.name}\``,
        `Stack: \`\`\`\n${error.stack}\n\`\`\``,
      ].join('\n')
    });
  });
}