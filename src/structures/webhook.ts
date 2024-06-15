import { RESTPostAPIWebhookWithTokenJSONBody } from 'discord-api-types/v10';
import { createLogger } from '~/structures/logger';
import { splitMessage } from '~/utilities';
import sleep from '~/utilities/sleep';

interface File {
	path: string;
	mimeType: string;
	buffer: Buffer;
	name: string;
}

const Logger = createLogger('Webhook');

class Webhook {
	async send(url: string, message: RESTPostAPIWebhookWithTokenJSONBody, files?: File[]) {
		if (message.content?.length > 2000) {
			const chunks = splitMessage(message.content);

			for (const chunk of chunks) {
				await this.send(url, { ...message, content: chunk });
			}

			if (files?.length) {
				await this.send(url, { ...message, content: '' }, files);
			}

			return;
		}

		try {
			const data = new FormData();

			data.append('payload_json', JSON.stringify(message));

			if (files?.length) {
				for (let i = 1; i < files.length + 1; i++) {
					const file = files[i - 1];
					const field = 'file' + i;

					data.append(field, new Blob([file.buffer]), file.name);
				}
			}

			const res = await fetch(url, {
				method: 'POST',
				body: data
			});

			if (!res.ok) {
				const data = await res.json();

				if (!data.retry_after) {
					Logger.error('Received error:', data);
					return;
				}

				Logger.log(`Hit ratelimit, waiting ${data.retry_after * 1000}ms.`);
				await sleep(data.retry_after * 1000);
				await this.send(url, message, files);
			}
		} catch (e) {
			Logger.log(`!! Webhook failed to send: ${e.message} !!`);
		}
	};
}

export default new Webhook();