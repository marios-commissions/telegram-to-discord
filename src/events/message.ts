import type { Chat, Reply, Listener } from '~/typings/structs';
import type { NewMessageEvent } from 'telegram/events';
import { codeblock, getContent, getFiles } from '~/utilities';
import { NewMessage } from 'telegram/events';
import { Client, Webhook } from '~/structures';
import { Api } from 'telegram';
import config from '~/config';
import { type APIEmbed } from 'discord-api-types/v10';

Client.addEventHandler(onMessage, new NewMessage());

async function onMessage({ message, chatId }: NewMessageEvent & { chat: Chat; }) {
	if (!config.messages.commands && message.message.startsWith('/')) return;

	const author = await message.getSender() as Api.User;
	const chat = await message.getChat() as Chat & { hasLink: boolean; broadcast: boolean; };

	if (!chat) return;

	if (
		(!chat.hasLink && !chat.broadcast && !author?.username) ||
		(author?.username && ~config.messages.blacklist.indexOf(author.username))
	) return;

	const isForum = chat.forum;
	const isLinked = chat.hasLink || chat.broadcast;

	Client._log.info(`New message from ${chatId}:${author?.username ?? chat?.title}:${author?.id ?? chat?.id} - Channel Type: ${isForum ? 'Forum' : isLinked ? 'Linked' : 'Group/Private'}`);

	const listeners = config.listeners.filter(l => l.group == chatId.toString());
	if (!listeners.length) return;

	if (isForum) {
		const reply = await message.getReplyMessage() as Reply;

		for (const listener of listeners.filter(l => l.forum) as Listener[]) {
			if (listener.group != chatId.toString()) continue;

			onForumMessage({ message, chat, chatId, author, reply, listener });
		}
	} else if (isLinked) {
		for (const listener of listeners.filter(l => chat.hasLink ? l.linked : true) as Listener[]) {
			if (listener.group != chatId.toString()) continue;

			onLinkedMessage({ message, chat, chatId, author, listener });
		}
	} else {
		for (const listener of listeners.filter(l => !l.forum) as Listener[]) {
			if (listener.group != chatId.toString()) continue;

			onGroupMessage({ message, chat, chatId, author, listener });
		}
	}
}

interface HandlerArguments {
	chatId: bigInt.BigInteger;
	message: Api.Message;
	listener: Listener;
	author: Api.User;
	chat: Chat;
}

async function onForumMessage({ message, author, chat, chatId, reply, listener }: HandlerArguments & { reply: Reply; }) {
	if (!listener.stickers && message.sticker) return;

	const isTopic = reply?.replyTo?.forumTopic ?? false;
	const topicId = reply?.replyTo?.replyToTopId ?? reply?.replyTo?.replyToMsgId;

	const [topic] = (isTopic ? await Client.getMessages(chatId, { ids: [topicId] }) : [reply]) as Reply[];

	const channel = listener.channels?.find((payload) => {
		if (payload.name === topic?.action?.title) {
			return true;
		}

		if (payload.main && !topic?.action?.title) {
			return true;
		}

		return false;
	});

	if (listener.channels?.length && !channel) return;

	const user = listener.users?.find(user => user === author.username);
	if (listener.users?.length && !user) return;

	const files = await getFiles(message);

	if (!message.rawText && !files.length) return;

	const hasReply = reply?.id !== topic?.id;
	const replyAuthor = hasReply && await reply?.getSender?.() as Api.User;

	const shouldEmbed = typeof listener.embedded === 'boolean' && listener.embedded;
	const shouldEmbedUser = typeof listener.embedded === 'object' && Array.isArray(listener.embedded) && (listener.embedded as string[])!.includes(author.username);
	const shouldEmbedReply = typeof listener.embedded === 'object' && Array.isArray(listener.embedded) && (listener.embedded as string[])!.includes(replyAuthor.username);

	const replyText = replyAuthor && `> \`${replyAuthor.firstName + ':'}\` ${getContent(reply, listener, channel)}`.split('\n').join('\n> ');
	const messageText = `${codeblock((author?.firstName ?? chat.title) + ':')} ${getContent(message, listener, channel)}`;

	const content = [!shouldEmbedReply ? replyText : '', messageText].filter(Boolean).join('\n').trim();

	const embed: APIEmbed = {
		color: listener.embedColor ?? 16711680,
		description: content
	};

	const replyEmbed: APIEmbed = {
		color: listener.embedColor ?? 16711680,
		description: replyText
	};

	if (shouldEmbed || shouldEmbedUser || shouldEmbedReply) {
		Webhook.send(listener.webhook, {
			username: listener.name,
			content: shouldEmbedReply ? content : '',
			embeds: [!shouldEmbedReply ? embed : replyEmbed]
		}, files);
	} else {
		Webhook.send(listener.webhook, {
			username: listener.name,
			content
		}, files);
	}
}


async function onLinkedMessage({ message, chat, listener }: HandlerArguments) {
	const files = await getFiles(message);
	if (!message.rawText && !files.length) return;
	if (!listener.stickers && message.sticker) return;

	const reply = await message.getReplyMessage() as Reply;
	const replyAuthor = await reply?.getSender() as Api.User;
	const author = await message.getSender() as Api.User;

	const shouldEmbed = typeof listener.embedded === 'boolean' && listener.embedded;
	const shouldEmbedUser = typeof listener.embedded === 'object' && Array.isArray(listener.embedded) && (listener.embedded as string[])!.includes(author.username);
	const shouldEmbedReply = typeof listener.embedded === 'object' && Array.isArray(listener.embedded) && (listener.embedded as string[])!.includes(replyAuthor.username);

	const replyText = replyAuthor && `> \`${replyAuthor.firstName + ':'}\` ${getContent(reply, listener)}`.split('\n').join('\n> ');
	const messageText = `${codeblock((author?.firstName ?? chat.title) + ':')} ${getContent(message, listener)}`;

	const content = [!shouldEmbedReply ? replyText : '', messageText].filter(Boolean).join('\n').trim();

	const embed: APIEmbed = {
		color: listener.embedColor ?? 16711680,
		description: content
	};

	const replyEmbed: APIEmbed = {
		color: listener.embedColor ?? 16711680,
		description: replyText
	};

	if (shouldEmbed || shouldEmbedUser || shouldEmbedReply) {
		Webhook.send(listener.webhook, {
			username: listener.name,
			content: shouldEmbedReply ? content : '',
			embeds: [!shouldEmbedReply ? embed : replyEmbed]
		}, files);
	} else {
		Webhook.send(listener.webhook, {
			username: listener.name,
			content
		}, files);
	}
};

async function onGroupMessage({ message, author, chat, listener }: HandlerArguments) {
	const user = listener.users?.find(user => user === author.username);
	if (listener.users?.length && !user) return;
	if (!listener.stickers && message.sticker) return;

	const files = await getFiles(message);

	if (!message.rawText && !files.length) return;

	const reply = await message.getReplyMessage() as Reply;
	const replyAuthor = await reply?.getSender() as Api.User;

	const shouldEmbed = typeof listener.embedded === 'boolean' && listener.embedded;
	const shouldEmbedUser = typeof listener.embedded === 'object' && Array.isArray(listener.embedded) && (listener.embedded as string[])!.includes(author.username);
	const shouldEmbedReply = typeof listener.embedded === 'object' && Array.isArray(listener.embedded) && (listener.embedded as string[])!.includes(replyAuthor.username);

	const replyText = replyAuthor && `> \`${replyAuthor.firstName + ':'}\` ${getContent(reply, listener)}`.split('\n').join('\n> ');
	const messageText = `${codeblock((author?.firstName ?? chat.title) + ':')} ${getContent(message, listener)}`;

	const content = [!shouldEmbedReply ? replyText : '', messageText].filter(Boolean).join('\n').trim();

	const embed: APIEmbed = {
		color: listener.embedColor ?? 16711680,
		description: content
	};

	const replyEmbed: APIEmbed = {
		color: listener.embedColor ?? 16711680,
		description: replyText
	};

	if (shouldEmbed || shouldEmbedUser || shouldEmbedReply) {
		Webhook.send(listener.webhook, {
			username: listener.name,
			content: shouldEmbedReply ? content : '',
			embeds: [!shouldEmbedReply ? embed : replyEmbed]
		}, files);
	} else {
		Webhook.send(listener.webhook, {
			username: listener.name,
			content
		}, files);
	}
};
