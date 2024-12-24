import { AllowedMentionsTypes } from 'discord-api-types/v10';
import { getContent, getFiles } from '~/utilities';
import { Client } from '~/structures/index';
import Webhook from '~/structures/webhook';
import { Raw } from 'telegram/events';
import config from '@config.json';
import { Listener } from '@types';
import { Api } from 'telegram';


Client.addEventHandler(onUpdatePinnedMessages, new Raw({ types: [Api.UpdatePinnedChannelMessages] }));

async function onUpdatePinnedMessages(payload) {
	if (!payload.pinned) return;

	const chat = await Client.invoke(new Api.channels.GetFullChannel({ channel: payload.channelId }));
	const id = await Client.getPeerId(chat.fullChat, true);
	const listeners = config.listeners.filter(l => l.group === id.toString() && l.pins);
	const messages = await Client.getMessages(payload.channelId, { ids: payload.messages });


	for (const listener of listeners as Listener[]) {
		await Webhook.send(listener.webhook, {
			...(listener.extraWebhookParameters ?? {}),
			username: listener.name,
			content: `@everyone Message pinned.`,
			allowed_mentions: { parse: [AllowedMentionsTypes.Everyone] }
		});

		for (const message of messages) {
			const content = getContent(message);

			await Webhook.send(listener.webhook, {
				...(listener.extraWebhookParameters ?? {}),
				username: listener.name,
				content
			}, await getFiles(message));
		}
	}
}