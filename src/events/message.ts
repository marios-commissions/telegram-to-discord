import { EditedMessage, type EditedMessageEvent } from 'telegram/events/EditedMessage';
import type { MessageContext, Chat, Reply, Listener } from '@types';
import { codeblock, getContent, getFiles, hash } from '~/utilities';
import { findMessageHash, insertMessageHash } from '~/database';
import type { NewMessageEvent } from 'telegram/events';
import { type APIEmbed } from 'discord-api-types/v10';
import { Client, Webhook } from '~/structures';
import { NewMessage } from 'telegram/events';
import config from '@config.json';
import { Api } from 'telegram';


Client.addEventHandler(onMessage, new NewMessage());

Client.addEventHandler((event: EditedMessageEvent) => {
	// @ts-expect-error
	event.message._edit = true;
	onMessage(event);
}, new EditedMessage({}));

async function onMessage({ message, chatId }: NewMessageEvent) {
	const context = await getMessageContext(message, chatId);
	if (!context) return;

	if (isBlacklisted(context.usernames)) {
		Client._log.info('Preventing forward of blacklisted user: ' + context.usernames.join(' or '));
		return;
	}

	logMessageInfo(context);

	const listeners = getEligibleListeners(context);
	if (!listeners.length) return;

	if (!await shouldProcessEdit(message, chatId)) return;

	await processMessage(context, listeners);
}

async function getMessageContext(message: any, chatId: any): Promise<MessageContext | null> {
	const author = await message.getSender() as Api.User;
	const chat = await message.getChat();
	if (!chat || !author) return null;

	const usernames = [
		...(author.usernames?.map(u => u?.username) ?? []),
		author.username,
		author?.id?.toString()
	].filter(Boolean);

	return {
		message,
		chat,
		chatId,
		author,
		usernames,
		isDM: chat.className === 'User'
	};
}

function isBlacklisted(usernames: string[]): boolean {
	return usernames.some(u => config.messages.blacklist.includes(u));
}

function logMessageInfo({ chatId, author, chat, isDM, chat: { forum, hasLink, broadcast } }: MessageContext) {
	const channelType = forum ? 'Forum' : (hasLink || broadcast) ? 'Linked' : 'Group/Private';
	Client._log.info(
		`New message from ${chatId}:${author?.username ?? chat?.title}:${author?.id ?? chat?.id} - Channel Type: ${channelType}`
	);
}

function getEligibleListeners({ message, chatId, usernames }: MessageContext): Listener[] {
	return (config.listeners as Listener[]).filter(listener => {
		if (listener.blacklistedUsers?.some(u => usernames.includes(u))) return false;
		if (!listener.trackEdits && message._edit) return false;
		if (listener.hasContent?.length && !listener.hasContent.every(c => message.rawText?.includes(c))) return false;
		if (listener.users?.length && !usernames.some(u => listener.users?.includes(u))) return false;
		if (listener.group && listener.group !== chatId.toString()) return false;
		if (!listener.commands && message.message.startsWith('/')) return false;
		return true;
	});
}

async function shouldProcessEdit(message: any, chatId: any): Promise<boolean> {
	if (!message._edit) return true;

	const messageHash = await findMessageHash(chatId.toString(), message.id.toString());
	if (!messageHash) return true;

	return messageHash !== hash(message.rawText);
}

async function processMessage(context: MessageContext, listeners: Listener[]) {
	const { chat, message, chatId } = context;

	const filteredListeners = filterListenersByType(listeners, context);
	if (!filteredListeners.length) return;

	for (const listener of filteredListeners) {
		if (!isListenerValid(listener, context)) continue;

		await handleMessage(listener, context);
		await forwardMessage(message, listener);
	}

	const messageHash = hash(message.rawText);
	await insertMessageHash(chatId.toString(), message.id.toString(), messageHash);
}

function filterListenersByType(listeners: Listener[], { chat }: MessageContext): Listener[] {
	const isForum = chat.forum;
	const isLinked = chat.hasLink || chat.broadcast;

	return listeners.filter(l => {
		if (isForum) return l.forum || (!l.group && l.users?.length);
		if (isLinked) return (chat.hasLink ? l.linked : true) || (!l.group && l.users?.length);
		return !l.forum || (!l.group && l.users?.length);
	});
}

function isListenerValid(listener: Listener, { chatId, isDM, message }: MessageContext): boolean {
	if (listener.whitelistOnly && !(listener.whitelist ?? []).includes(chatId.toString())) return false;
	if (!listener.whitelistOnly && (listener.blacklist ?? []).includes(chatId.toString())) return false;
	if (!listener.stickers && message.sticker) return false;
	if (isDM && !listener.allowDMs) return false;
	return true;
}

async function handleMessage(listener: Listener, context: MessageContext) {
	const { chat, message } = context;

	const isForum = chat.forum;
	const isLinked = chat.hasLink || chat.broadcast;

	if (isForum) {
		const reply = await message.getReplyMessage() as Reply;
		onForumMessage({ ...context, reply, listener });
	} else if (isLinked) {
		onLinkedMessage({ ...context, listener });
	} else {
		onGroupMessage({ ...context, listener });
	}
}

async function forwardMessage(message: any, listener: Listener) {
	if (!listener.forwardTo) return;

	const chat = await Client.getEntity(listener.forwardTo);
	if (chat) {
		await message.forwardTo(chat);
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

	if ((listener.channels?.length && !channel) || (!listener.users?.length && !listener.channels?.length)) return;

	const files = await getFiles(message);

	if (!message.rawText && !files.length) return;
	if (listener.excludeEmptyMessages && !message.rawText) return;


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
		// @ts-expect-error
		message._edit ? `__**Edited: ${new Date(message.editDate * 1000).toLocaleString()}**__` : '',
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
			username: listener.name ?? ((listener.showUser ?? false) ? `${(listener.useReplyUserInsteadOfAuthor ? replyAuthor?.username : author.username) ?? 'Unknown'} | ${chat.title ?? 'DM'}` : (listener.includeForumChannelName && channel.name ? `${chat.title} -> ${channel.name}` : chat.title)),
			content: shouldEmbedReply ? content : '',
			embeds: [!shouldEmbedReply && shouldShowReply ? embed : replyEmbed]
		}, files);
	} else {
		Webhook.send(channel?.webhook ?? listener.webhook, {
			...(listener.extraWebhookParameters ?? {}),
			username: listener.name ?? ((listener.showUser ?? false) ? `${(listener.useReplyUserInsteadOfAuthor ? replyAuthor?.username : author.username) ?? 'Unknown'} | ${chat.title ?? 'DM'}` : (listener.includeForumChannelName && channel.name ? `${chat.title} -> ${channel.name}` : chat.title)),
			content
		}, files);
	}
}

async function onLinkedMessage({ message, author, chat, usernames, listener }: HandlerArguments) {
	const files = await getFiles(message);

	if (!message.rawText && !files.length) return;
	if (listener.excludeEmptyMessages && !message.rawText) return;
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
		// @ts-expect-error
		message._edit ? `__**Edited: ${new Date(message.editDate * 1000).toLocaleString()}**__` : '',
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
	if (listener.excludeEmptyMessages && !message.rawText) return;

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
		// @ts-expect-error
		message._edit ? `__**Edited: ${new Date(message.editDate * 1000).toLocaleString()}**__` : '',
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
