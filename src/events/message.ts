import type { Chat, Reply, Listener } from '~/typings/structs';
import { codeblock, getContent, getFiles } from '~/utilities';
import type { NewMessageEvent } from 'telegram/events';
import { type APIEmbed } from 'discord-api-types/v10';
import { Client, Webhook } from '~/structures';
import { NewMessage } from 'telegram/events';
import { Api } from 'telegram';
import config from '~/config';


Client.addEventHandler(onMessage, new NewMessage());

async function onMessage({ message, chatId }: NewMessageEvent & { chat: Chat; }) {
	const author = await message.getSender() as Api.User;
	const chat = await message.getChat() as Chat & { hasLink: boolean; broadcast: boolean; };
	if (!chat || !author) return;

	const usernames = [...(author.usernames?.map(u => u?.username) ?? []), author.username, author?.id?.toString()].filter(Boolean);

	if (usernames.length && usernames.some(u => config.messages.blacklist.includes(u))) {
		Client._log.info('Preventing forward of blacklisted user: ' + usernames.join(' or '));
		return;
	}

	// @ts-ignore
	const isDM = chat.className === 'User';
	const isForum = chat.forum;
	const isLinked = chat.hasLink || chat.broadcast;

	Client._log.info(`New message from ${chatId}:${author?.username ?? chat?.title}:${author?.id ?? chat?.id} - Channel Type: ${isForum ? 'Forum' : isLinked ? 'Linked' : 'Group/Private'}`);

	const listeners = (config.listeners as Listener[]).filter(listener => {
		if (listener.users?.length && !usernames.some(u => listener.users?.includes(u))) {
			return false;
		}

		if (listener.group && listener.group != chatId.toString()) {
			return false;
		}

		if (!listener.commands && message.message.startsWith('/')) {
			return false;
		}

		return true;
	});

	if (!listeners.length) return;

	if (isForum) {
		const reply = await message.getReplyMessage() as Reply;

		for (const listener of listeners.filter(l => l.forum || (!l.group && l.users?.length)) as Listener[]) {
			if (listener.whitelistOnly && !(listener.whitelist ?? []).includes(chatId.toString())) continue;
			if (!listener.whitelistOnly && (listener.blacklist ?? []).includes(chatId.toString())) continue;
			if (!listener.stickers && message.sticker) continue;
			if (isDM && !listener.allowDMs) continue;

			onForumMessage({ message, chat, chatId, author, reply, listener, usernames });

			if (listener.forwardTo) {
				const chat = await Client.getEntity(listener.forwardTo);
				if (!chat) continue;

				await message.forwardTo(chat);
			}
		}
	} else if (isLinked) {
		for (const listener of listeners.filter(l => chat.hasLink ? l.linked : true || (!l.group && l.users?.length)) as Listener[]) {
			if (listener.whitelistOnly && !(listener.whitelist ?? []).includes(chatId.toString())) continue;
			if (!listener.whitelistOnly && (listener.blacklist ?? []).includes(chatId.toString())) continue;
			if (!listener.stickers && message.sticker) continue;
			if (isDM && !listener.allowDMs) continue;

			onLinkedMessage({ message, chat, chatId, author, listener, usernames });

			if (listener.forwardTo) {
				const chat = await Client.getEntity(listener.forwardTo);
				if (!chat) continue;

				await message.forwardTo(chat);
			}
		}
	} else {
		for (const listener of listeners.filter(l => !l.forum || (!l.group && l.users?.length)) as Listener[]) {
			if (listener.whitelistOnly && !(listener.whitelist ?? []).includes(chatId.toString())) continue;
			if (!listener.whitelistOnly && (listener.blacklist ?? []).includes(chatId.toString())) continue;
			if (!listener.stickers && message.sticker) continue;
			if (isDM && !listener.allowDMs) continue;

			onGroupMessage({ message, chat, chatId, author, listener, usernames });

			if (listener.forwardTo) {
				const chat = await Client.getEntity(listener.forwardTo);
				if (!chat) continue;

				await message.forwardTo(chat);
			}
		}
	}
}

interface HandlerArguments {
	chatId: bigInt.BigInteger;
	message: Api.Message;
	usernames: string[];
	listener: Listener;
	author: Api.User;
	chat: Chat;
}

async function onForumMessage({ message, author, chat, chatId, reply, listener, usernames }: HandlerArguments & { reply: Reply; }) {
	if (!listener.stickers && message.sticker) return;

	const hasReply = !reply?.action;
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

	if ((listener.channels.length && !channel) || (!listener.users?.length && !listener.channels?.length)) return;

	const files = await getFiles(message);

	if (!message.rawText && !files.length) return;

	const replyAuthor = await reply?.getSender?.() as Api.User;
	if (listener.repliesOnly && !replyAuthor) return;

	const replyAuthorUsernames = [...(replyAuthor?.usernames ?? []), replyAuthor?.username, replyAuthor?.id?.toString()].filter(Boolean);

	if (listener.replyingTo && !listener.replyingTo?.some(t => replyAuthorUsernames.includes(t))) return;

	const sites = `(${config.messages.allowedEmbeds.map(r => r.replaceAll('.', '\\.')).join('|')})`;
	const embeddable = new RegExp(`https?:\/\/(www\.)?${sites}([-a-zA-Z0-9()@:%_\+.~#?&\/\/=]*)`, 'mi');
	const link = listener.dontEmbedSingularLinks && message.rawText?.match(embeddable);
	const isSingularLink = link && message.rawText.length === link[0].length;

	const shouldEmbed = !isSingularLink && typeof listener.embedded === 'boolean' && listener.embedded;
	const shouldEmbedUser = typeof listener.embedded === 'object' && Array.isArray(listener.embedded) && usernames.some(u => (listener.embedded as string[])!.includes(u as string));
	const shouldEmbedReply = typeof listener.embedded === 'object' && Array.isArray(listener.embedded) && replyAuthorUsernames.some(u => (listener.embedded as string[])!.includes(u as string));
	const shouldShowReply = listener.showReplies ?? true;

	const replyText = replyAuthor && hasReply && `> \`${replyAuthor?.firstName + ':'}\` ${getContent(reply, listener, channel)}`.split('\n').join('\n> ');
	const messageText = `${!(listener.showUser ?? false) ? codeblock((author?.firstName ?? chat.title) + ':') : ''} ${message.rawText && getContent(message, listener, channel)}`;

	const content = [
		listener.mention ? '@everyone' : '',
		message.forward && `__**Forwarded from ${(message.forward.sender as Api.User).username}**__`,
		(!shouldEmbedReply && shouldShowReply) ? replyText : '',
		messageText
	].filter(Boolean).join('\n').trim();


	const embed: APIEmbed = {
		color: listener.embedColor ?? 16711680,
		description: content
	};

	const replyEmbed: APIEmbed = {
		color: listener.embedColor ?? 16711680,
		description: replyText
	};

	if (shouldEmbed || shouldEmbedUser || shouldEmbedReply) {
		Webhook.send(channel?.webhook ?? listener.webhook, {
			...(listener.extraWebhookParameters ?? {}),
			username: listener.name ?? ((listener.showUser ?? false) ? `${(listener.useReplyUserInsteadOfAuthor ? replyAuthor?.username : author.username) ?? 'Unknown'} | ${chat.title ?? 'DM'}` : chat.title),
			content: shouldEmbedReply ? content : '',
			embeds: [!shouldEmbedReply && shouldShowReply ? embed : replyEmbed]
		}, files);
	} else {
		Webhook.send(channel?.webhook ?? listener.webhook, {
			...(listener.extraWebhookParameters ?? {}),
			username: listener.name ?? ((listener.showUser ?? false) ? `${(listener.useReplyUserInsteadOfAuthor ? replyAuthor?.username : author.username) ?? 'Unknown'} | ${chat.title ?? 'DM'}` : chat.title),
			content
		}, files);
	}
}

async function onLinkedMessage({ message, author, chat, usernames, listener }: HandlerArguments) {
	const files = await getFiles(message);
	if (!message.rawText && !files.length) return;
	if (!listener.stickers && message.sticker) return;

	const reply = await message.getReplyMessage() as Reply;
	const replyAuthor = await reply?.getSender() as Api.User;
	const replyAuthorUsernames = [...(replyAuthor?.usernames ?? []), replyAuthor?.username, replyAuthor?.id?.toString()].filter(Boolean);

	if (listener.replyingTo && !listener.replyingTo?.some(t => replyAuthorUsernames.includes(t))) return;

	const sites = `(${config.messages.allowedEmbeds.map(r => r.replaceAll('.', '\\.')).join('|')})`;
	const embeddable = new RegExp(`https?:\/\/(www\.)?${sites}([-a-zA-Z0-9()@:%_\+.~#?&\/\/=]*)`, 'mi');
	const link = message.rawText?.match(embeddable);
	const isSingularLink = link && message.rawText.length === link[0].length;

	const shouldEmbed = !isSingularLink && typeof listener.embedded === 'boolean' && listener.embedded;
	const shouldEmbedUser = typeof listener.embedded === 'object' && Array.isArray(listener.embedded) && usernames.every(u => (listener.embedded as string[])!.includes(u));
	const shouldEmbedReply = typeof listener.embedded === 'object' && Array.isArray(listener.embedded) && replyAuthorUsernames.every(u => (listener.embedded as string[]).includes(u.toString()));
	const shouldShowReply = listener.showReplies ?? true;

	const replyText = replyAuthor && `> \`${replyAuthor?.firstName + ':'}\` ${getContent(reply, listener)}`.split('\n').join('\n> ');
	const messageText = `${!(listener.showUser ?? false) ? codeblock((author?.firstName ?? chat.title) + ':') : ''} ${getContent(message, listener)}`;

	const content = [
		listener.mention ? '@everyone' : '',
		message.forward && `__**Forwarded from ${(message.forward.sender as Api.User)?.username ?? 'Unknown'}**__`,
		(!shouldEmbedReply && shouldShowReply) ? replyText : '',
		messageText
	].filter(Boolean).join('\n').trim();

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
			...(listener.extraWebhookParameters ?? {}),
			username: listener.name ?? ((listener.showUser ?? false) ? `${(listener.useReplyUserInsteadOfAuthor ? replyAuthor?.username : author.username) ?? 'Unknown'} | ${chat.title ?? 'DM'}` : chat.title),
			content: shouldEmbedReply ? content : '',
			embeds: [!shouldEmbedReply ? embed : replyEmbed]
		}, files);
	} else {
		Webhook.send(listener.webhook, {
			...(listener.extraWebhookParameters ?? {}),
			username: listener.name ?? ((listener.showUser ?? false) ? `${(listener.useReplyUserInsteadOfAuthor ? replyAuthor?.username : author.username) ?? 'Unknown'} | ${chat.title ?? 'DM'}` : chat.title),
			content
		}, files);
	}
}

async function onGroupMessage({ message, author, usernames, chat, listener }: HandlerArguments) {
	const user = listener.users?.find?.(user => usernames.some(u => user === u));
	if (listener.users?.length && !user) return;
	if (!listener.stickers && message.sticker) return;

	const files = await getFiles(message);

	if (!message.rawText && !files.length) return;

	const reply = await message.getReplyMessage() as Reply;
	const replyAuthor = await reply?.getSender() as Api.User;
	const replyAuthorUsernames = [...(replyAuthor?.usernames ?? []), replyAuthor?.username, replyAuthor?.id?.toString()].filter(Boolean);

	if (listener.replyingTo && !listener.replyingTo?.some(t => replyAuthorUsernames.includes(t))) return;

	const sites = `(${config.messages.allowedEmbeds.map(r => r.replaceAll('.', '\\.')).join('|')})`;
	const embeddable = new RegExp(`https?:\/\/(www\.)?${sites}([-a-zA-Z0-9()@:%_\+.~#?&\/\/=]*)`, 'mi');
	const link = message.rawText?.match(embeddable);
	const isSingularLink = link && message.rawText.length === link[0].length;

	const shouldEmbed = !isSingularLink && typeof listener.embedded === 'boolean' && listener.embedded;
	const shouldEmbedUser = typeof listener.embedded === 'object' && Array.isArray(listener.embedded) && usernames.some(u => (listener.embedded as string[])!.includes(u));
	const shouldEmbedReply = typeof listener.embedded === 'object' && Array.isArray(listener.embedded) && replyAuthorUsernames.some(u => (listener.embedded as string[])!.includes(u.toString()));
	const shouldShowReply = listener.showReplies ?? true;

	const replyText = replyAuthor && `> \`${replyAuthor?.firstName + ':'}\` ${getContent(reply, listener)}`.split('\n').join('\n> ');
	const messageText = `${!(listener.showUser ?? false) ? codeblock((author?.firstName ?? chat.title) + ':') : ''} ${getContent(message, listener)}`;

	const content = [
		listener.mention ? '@everyone' : '',
		message.forward && `__**Forwarded from ${(message.forward.sender as Api.User).username}**__`,
		(!shouldEmbedReply && shouldShowReply) ? replyText : '',
		messageText
	].filter(Boolean).join('\n').trim();

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
			...(listener.extraWebhookParameters ?? {}),
			username: listener.name ?? ((listener.showUser ?? false) ? `${(listener.useReplyUserInsteadOfAuthor ? replyAuthor?.username : author.username) ?? 'Unknown'} | ${chat.title ?? 'DM'}` : chat.title),
			content: shouldEmbedReply ? content : '',
			embeds: [!shouldEmbedReply ? embed : replyEmbed]
		}, files);
	} else {
		Webhook.send(listener.webhook, {
			...(listener.extraWebhookParameters ?? {}),
			username: listener.name ?? ((listener.showUser ?? false) ? `${(listener.useReplyUserInsteadOfAuthor ? replyAuthor?.username : author.username) ?? 'Unknown'} | ${chat.title ?? 'DM'}` : chat.title),
			content
		}, files);
	}
}
