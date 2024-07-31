import { ClientOptions, SessionName } from '~/constants';
import { Api, TelegramClient } from 'telegram';
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


		const banner = [];


		const promises = [];

		for (const group of groups) {
			promises.push(new Promise(async (resolve) => {
				const entity = await this.getEntity(group.id);

				const isDM = entity.className === 'User';
				const isForum = (entity as Api.Channel).forum;
				const isLinked = (entity as Api.Channel).hasLink || (entity as Api.Channel).broadcast;

				const topics = [];

				if (isForum) {
					const request = await this.invoke(new Api.channels.GetForumTopics({ channel: entity }));

					for (const topic of (request?.topics ?? []) as Api.ForumTopic[]) {
						topics.push(topic.title);
					}
				}

				banner.push([
					`${group.name} (${group.id.toString()})`,
					`- Is Pinned: ${group.pinned}`,
					`- Type: ${isForum ? 'Forum' : isLinked ? 'Linked' : isDM ? 'DM' : 'Group'}`,
					topics.length && '- Topics',
					...((topics.length && topics.map(t => `-- ${t}`)) || []),
					' '
				].filter(Boolean).join('\n'));

				resolve(true);
			}));
		}

		await Promise.all(promises);

		console.info('Channels\n' + banner.join('\n'));

		import('~/src/events');
	}
}

export default new Client();