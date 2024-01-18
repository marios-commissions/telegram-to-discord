import { ClientOptions, SessionName } from '~/constants';
import { TelegramClient } from 'telegram';
import config from '~/config';
import input from 'input';

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

		console.log('» Channels:\n' + groups.map(e => `${e.name} » ${e.id.toString()}`).join('\n'));

		import('~/src/events');
	}
}

export default new Client();