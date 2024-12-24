import sourcemaps from 'source-map-support';


sourcemaps.install();

import { Client, Webhook } from '~/structures';
import { init } from '~/database';
import config from '@config.json';

async function start() {
	await init();
	await Client.initialize();
}

start();

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