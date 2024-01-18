import { AllowedMentionsTypes } from 'discord-api-types/v10';
import { getContent, getFiles } from '~/utilities';
import { Listener } from '@typings/structs';
import { Raw } from 'telegram/events';
import { Client } from '~/lib/index';
import Webhook from '~/lib/webhook';
import { Api } from 'telegram';
import config from '~/config';

Client.addEventHandler(onUpdatePinnedMessages, new Raw({ types: [Api.UpdatePinnedChannelMessages] }));

async function onUpdatePinnedMessages(payload) {
	if (!payload.pinned) return;

	const chat = await Client.invoke(new Api.channels.GetFullChannel({ channel: payload.channelId }));
	const id = await Client.getPeerId(chat.fullChat, true);
	const listeners = config.listeners.filter(l => l.group === id.toString() && l.pins);
	const messages = await Client.getMessages(payload.channelId, { ids: payload.messages });


	for (const listener of listeners as Listener[]) {
		await Webhook.send(listener.webhook, {
			username: listener.name,
			content: `@everyone Message pinned.`,
			allowed_mentions: { parse: [AllowedMentionsTypes.Everyone] }
		});

		for (const message of messages) {
			const content = getContent(message);

			await Webhook.send(listener.webhook, {
				username: listener.name,
				content
			}, await getFiles(message));
		}
	}
}