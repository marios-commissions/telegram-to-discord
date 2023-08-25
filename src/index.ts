import { Client } from '@lib';
import config from '@config';

Client.initialize();

if (config.errors.catch) {
	process.on('uncaughtException', (error, origin) => {
		console.error([
			'**An error occured inside discord-twitter-forward**',
			'',
			`Origin: ${origin ?? 'Unknown'}`,
			`Cause: ${error.cause ?? 'Unknown'}`,
			`Type: ${error.name}`,
			`Stack: ${error.stack}\n`,
		].join('\n'));
		// Webhook.send(config.errors.webhook, {
		// 	content: console.error([
		// 		'**An error occured inside discord-twitter-forward**',
		// 		'',
		// 		`Origin: \`${origin ?? 'Unknown'}\``,
		// 		`Cause: \`${error.cause ?? 'Unknown'}\``,
		// 		`Type: \`${error.name}\``,
		// 		`Stack: \`\`\`\n${error.stack}\n\`\`\``,
		// 	].join('\n'))
		// });
	});
}