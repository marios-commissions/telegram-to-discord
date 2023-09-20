import { Api, TelegramClient } from 'telegram';
import input from 'input';

import { ClientOptions, SessionName } from '@constants';
import { createLogger } from '@structures/logger';
import config from '@config';

const Logger = createLogger('Client');

class Client extends TelegramClient {
	constructor() {
		super(SessionName, config.api.id, config.api.hash, ClientOptions);
	}

	async initialize() {
		await this.start({
			phoneNumber: config.phone,
			password: async () => input.text('Please enter your password: '),
			phoneCode: async () => input.text('Please enter the code you received: '),
			onError: (e) => console.error('Failed to log in:', e.message),
		});

		this._log.info('Successfully logged in.');

		const dialogs = await this.getDialogs();
		const groups = dialogs.filter(d => d.isChannel || d.isGroup);

		Logger.info('Channels\n' + groups.map(e => `${e.name} » ${e.id.toString()}`).join('\n'));

		import('@src/events');
	}
}

export default new Client();