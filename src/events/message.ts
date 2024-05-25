import type { Chat, Reply, Listener } from '@typings/structs';
import type { NewMessageEvent } from 'telegram/events';
import { getContent, getFiles } from '~/utilities';
import { NewMessage } from 'telegram/events';
import { Store, Client } from '~/lib';
import { Api } from 'telegram';
import config from '~/config';

Client.addEventHandler(onMessage, new NewMessage());

async function onMessage({ message, chatId }: NewMessageEvent & { chat: Chat; }) {
	if (!config.messages.commands && message.message.startsWith('/')) return;

	const author = await message.getSender() as Api.User;
	const chat = await message.getChat() as Chat & { hasLink: boolean; broadcast: boolean; };

	if (!chat || !author) return;

	const usernames = [...(author.usernames?.map(u => u.username) ?? []), author.username].filter(Boolean);

	if (usernames.length && usernames.some(u => config.messages.blacklist.includes(u))) {
		Client._log.info('Preventing forward of blacklisted user: ' + usernames.join(' or '));
		return;
	}

	const isForum = chat.forum;
	const isLinked = chat.hasLink || chat.broadcast;

	Client._log.info(`New message from ${chatId}:${author?.username ?? chat?.title}:${author?.id ?? chat?.id} - Channel Type: ${isForum ? 'Forum' : isLinked ? 'Linked' : 'Group/Private'}`);

	const listeners = config.listeners.filter(l => l.group == chatId.toString() || l.users?.includes(author?.id.toString()));
	if (!listeners.length) return;

	if (isForum) {
		const reply = await message.getReplyMessage() as Reply;

		for (const listener of listeners.filter(l => l.forum) as Listener[]) {
			onForumMessage({ message, chat, chatId, author, reply, listener, usernames });
		}
	} else if (isLinked) {
		for (const listener of listeners.filter(l => chat.hasLink ? l.linked : true) as Listener[]) {
			onLinkedMessage({ message, chat, chatId, author, listener, usernames });
		}
	} else {
		for (const listener of listeners.filter(l => !l.forum) as Listener[]) {
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

	if (listener.channels?.length) return;

	const user = listener.users?.find(user => usernames.some(u => u === user));
	if (listener.users?.length && !user) return;

	const files = await getFiles(message);

	if (!message.rawText && !files.length) return;

	const hasReply = reply?.id !== topic?.id;
	const replyAuthor = hasReply && await reply?.getSender?.() as Api.User;
	const replyAuthorUsernames = [...(replyAuthor?.usernames ?? []), replyAuthor?.username].filter(Boolean);

	Store.add({
		listener,
		time: Date.now(),
		author: {
			id: author.id?.toString(),
			username: author.username,
		},
		channel: {
			forum: true,
			id: chatId.toString(),
			name: chat.title
		},
		id: message.id.toString(),
		text: getContent(message, listener, channel),
		reply: {
			author: {
				id: replyAuthor?.id.toString(),
				username: replyAuthorUsernames.join(' or ')
			},
			id: reply?.id.toString(),
			text: reply ? getContent(reply, listener, channel) : null
		}
	});
}


async function onLinkedMessage({ message, chat, author, chatId, listener }: HandlerArguments) {
	const files = await getFiles(message);
	if (!message.rawText && !files.length) return;

	const reply = await message.getReplyMessage() as Reply;
	const replyAuthor = await reply?.getSender() as Api.Channel;
	const replyAuthorUsernames = [...(replyAuthor?.usernames ?? []), replyAuthor?.username].filter(Boolean);

	Store.add({
		listener,
		time: Date.now(),
		author: {
			id: author.id?.toString(),
			username: author.username,
		},
		channel: {
			forum: true,
			id: chatId.toString(),
			name: chat.title
		},
		id: message.id.toString(),
		text: getContent(message, listener),
		reply: {
			author: {
				id: replyAuthor?.id.toString(),
				username: replyAuthorUsernames.join(' or ')
			},
			id: reply?.id.toString(),
			text: reply ? getContent(reply, listener) : null
		}
	});
};

async function onGroupMessage({ message, author, chatId, chat, listener }: HandlerArguments) {
	const user = listener.users?.find(user => user === author.username);
	if (listener.users?.length && !user) return;

	const files = await getFiles(message);

	if (!message.rawText && !files.length) return;

	const reply = await message.getReplyMessage() as Reply;
	const replyAuthor = await reply?.getSender() as Api.User;
	const replyAuthorUsernames = [...(replyAuthor?.usernames ?? []), replyAuthor?.username].filter(Boolean);


	Store.add({
		listener,
		time: Date.now(),
		author: {
			id: author.id?.toString(),
			username: author.username,

		},
		channel: {
			forum: true,
			id: chatId.toString(),
			name: chat.title
		},
		id: message.id.toString(),
		text: getContent(message, listener),
		reply: {
			author: {
				id: replyAuthor?.id.toString(),
				username: replyAuthorUsernames.join(' or ')
			},
			id: reply?.id.toString(),
			text: reply ? getContent(reply, listener) : null
		}
	});
};
