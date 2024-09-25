import { Client, Webhook } from '~/structures';
import sourcemaps from 'source-map-support';
import config from '~/config';
import '~/structures/server';

sourcemaps.install();


Client.initialize();

if (config.errors.catch) {
	process.on('uncaughtException', (error, origin) => {
		console.error(error);
		Webhook.send(config.errors.webhook, {
			content: [
				'**An error occured inside telegram-to-discord**',
				'',
				`Origin: \`${origin ?? 'Unknown'}\``,
				`Cause: \`${error.cause ?? 'Unknown'}\``,
				`Type: \`${error.name}\``,
				`Stack: \`\`\`\n${error.stack}\n\`\`\``,
			].join('\n')
		});
	});
}