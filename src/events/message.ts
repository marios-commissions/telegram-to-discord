import type { Chat, Reply, Listener, Message } from '~/typings/structs';
import streamToString from '~/utilities/stream-to-string';
import type { NewMessageEvent } from 'telegram/events';
import { getContent, getFiles } from '~/utilities';
import ElevenLabs from '~/structures/elevenlabs';
import { NewMessage } from 'telegram/events';
import events from '~/structures/events';
import store from '~/structures/store';
import { Client } from '~/structures';
import { Api } from 'telegram';
import config from '~/config';

Client.addEventHandler(onMessage, new NewMessage());

async function onMessage({ message, chatId }: NewMessageEvent & { chat: Chat; }) {
	const author = await message.getSender() as Api.User;
	const chat = await message.getChat() as Chat & { hasLink: boolean; broadcast: boolean; };
	if (!chat || !author) return;

	const usernames = [...(author.usernames?.map(u => u.username) ?? []), author.username, author?.id?.toString()].filter(Boolean);

	if (usernames.length && usernames.some(u => config.messages.blacklist.includes(u))) {
		Client._log.info('Preventing forward of blacklisted user: ' + usernames.join(' or '));
		return;
	}

	// @ts-ignore
	const isDM = chat.className === 'User';
	const isForum = chat.forum;
	const isLinked = chat.hasLink || chat.broadcast;

	Client._log.info(`New message from ${chatId}:${author?.username ?? chat?.title}:${author?.id ?? chat?.id} - Channel Type: ${isForum ? 'Forum' : isLinked ? 'Linked' : 'Group/Private'}`);

	const listeners = config.listeners.filter(listener => {
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
		}
	} else if (isLinked) {
		for (const listener of listeners.filter(l => chat.hasLink ? l.linked : true || (!l.group && l.users?.length)) as Listener[]) {
			if (listener.whitelistOnly && !(listener.whitelist ?? []).includes(chatId.toString())) continue;
			if (!listener.whitelistOnly && (listener.blacklist ?? []).includes(chatId.toString())) continue;
			if (!listener.stickers && message.sticker) continue;
			if (isDM && !listener.allowDMs) continue;

			onLinkedMessage({ message, chat, chatId, author, listener, usernames });
		}
	} else {
		for (const listener of listeners.filter(l => !l.forum || (!l.group && l.users?.length)) as Listener[]) {
			if (listener.whitelistOnly && !(listener.whitelist ?? []).includes(chatId.toString())) continue;
			if (!listener.whitelistOnly && (listener.blacklist ?? []).includes(chatId.toString())) continue;
			if (!listener.stickers && message.sticker) continue;
			if (isDM && !listener.allowDMs) continue;

			onGroupMessage({ message, chat, chatId, author, listener, usernames });
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

	if (!listener.users?.length && !listener.channels?.length) return;

	const files = await getFiles(message);

	if (!message.rawText && files === 0) return;

	const replyAuthor = await reply?.getSender?.() as Api.User;
	if (listener.repliesOnly && !replyAuthor) return;

	const replyAuthorUsernames = [...(replyAuthor?.usernames ?? []), replyAuthor?.username, replyAuthor?.id?.toString()].filter(Boolean);

	if (listener.replyingTo && !listener.replyingTo?.some(t => replyAuthorUsernames.includes(t))) return;

	const shouldShowReply = listener.showReplies ?? true;

	const replyText = replyAuthor && hasReply && `This message is replying to ${replyAuthor?.firstName ?? 'Unknown'} that previously said: "${getContent(reply, listener, channel)}"`;
	const messageText = `${author?.firstName ?? 'Unknown'} says: ${message.rawText ? getContent(message, listener, channel) : 'No content.'}`;

	const content = [
		message.forward && `This message was forwarded from ${(message.forward.sender as Api.User).username}`,
		shouldShowReply ? replyText : '',
		messageText
	].filter(Boolean).join('\n').trim();

	receiveMessage(listener, { content, date: Date.now() });
}

async function onLinkedMessage({ message, author, chat, usernames, listener }: HandlerArguments) {
	const files = await getFiles(message);
	if (!message.rawText && !files.length) return;
	if (!listener.stickers && message.sticker) return;

	const reply = await message.getReplyMessage() as Reply;
	const replyAuthor = await reply?.getSender() as Api.User;
	const replyAuthorUsernames = [...(replyAuthor?.usernames ?? []), replyAuthor?.username, replyAuthor?.id?.toString()].filter(Boolean);

	if (listener.replyingTo && !listener.replyingTo?.some(t => replyAuthorUsernames.includes(t))) return;

	const shouldShowReply = listener.showReplies ?? true;

	const replyText = replyAuthor && `This message is replying to ${replyAuthor?.firstName ?? 'Unknown'} that previously said: "${getContent(reply, listener)}"`;
	const messageText = `${author?.firstName ?? 'Unknown'} says: ${message.rawText ? getContent(message, listener) : 'No content.'}`;

	const content = [
		message.forward && `This message was forwarded from ${(message.forward.sender as Api.User).username}`,
		shouldShowReply ? replyText : '',
		messageText
	].filter(Boolean).join('\n').trim();

	receiveMessage(listener, { content, date: Date.now() });
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

	const shouldShowReply = listener.showReplies ?? true;

	const replyText = replyAuthor && `This message is replying to ${replyAuthor?.firstName ?? 'Unknown'} that previously said: "${getContent(reply, listener)}"`;
	const messageText = `${author?.firstName ?? 'Unknown'} says: ${message.rawText ? getContent(message, listener) : 'No content.'}`;

	const content = [
		message.forward && `This message was forwarded from ${(message.forward.sender as Api.User).username}`,
		shouldShowReply ? replyText : '',
		messageText
	].filter(Boolean).join('\n').trim();

	receiveMessage(listener, { content, date: Date.now() });
}

async function receiveMessage(listener: Listener, message: Omit<Message, 'origin'>) {
	try {
		store.add(message);

		const stream = await ElevenLabs.textToSpeech.convert(listener.voiceId, { text: message.content });

		console.info('Streaming...');
		const content = await streamToString(stream);
		console.log('Streamed.');

		events.emit('tts', content?.buffer);
	} catch (error) {
		console.error('Failed to convert into text to speech:', error);
	}
}