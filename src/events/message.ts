import type { Chat, Reply, Listener } from '@typings/structs';
import type { NewMessageEvent } from 'telegram/events';

import { NewMessage } from 'telegram/events';
import mimeTypes from 'mime-types';
import { Api } from 'telegram';
import path from 'path';
import fs from 'fs';

import { uuid, codeblock } from '@utilities';
import { Store, Client } from '@lib';
import { Paths } from '@constants';
import config from '@config';

Client.addEventHandler(onMessage, new NewMessage());

async function onMessage({ message, chatId }: NewMessageEvent & { chat: Chat; }) {
	if (!config.messages.commands && message.message.startsWith('/')) return;

	const author = await message.getSender() as Api.User;
	const chat = await message.getChat() as Chat & { hasLink: boolean; broadcast: boolean; };

	if (
		(!chat.hasLink && !chat.broadcast && !author?.username) ||
		(author?.username && ~config.messages.blacklist.indexOf(author.username))
	) return;

	Client._log.info(`New message from ${chatId}:${author?.username ?? chat?.title}:${author?.id ?? chat?.id}`);

	const listeners = config.listeners.filter(l => l.group == chatId.toString());
	if (!listeners.length) return;

	if (chat.forum) {
		const reply = await message.getReplyMessage() as Reply;

		for (const listener of listeners.filter(l => l.forum) as Listener[]) {
			if (listener.group != chatId.toString()) continue;

			onForumMessage({ message, chat, chatId, author, reply, listener });
		}
	} else if (chat.hasLink || chat.broadcast) {
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

	Store.add(chatId.toString(), {
		listener,
		author: {
			id: author.id.toString(),
			username: author.username,
			displayName: author.firstName + ' ' + author.lastName
		},
		channel: {
			forum: true,
			id: chatId.toString(),
			name: chat.title
		},
		id: message.id.toString(),
		text: message.rawText,
		reply: {
			author: {
				displayName: replyAuthor?.firstName + ' ' + replyAuthor?.lastName,
				id: replyAuthor?.id.toString(),
				username: replyAuthor?.username
			},
			id: reply?.id.toString(),
			text: reply?.rawText
		}
	});
}


async function onLinkedMessage({ message, chat, author, chatId, listener }: HandlerArguments) {
	const files = await getFiles(message);
	if (!message.rawText && !files.length) return;

	const reply = await message.getReplyMessage() as Reply;
	const replyAuthor = await reply?.getSender() as Api.Channel;

	Store.add(chatId.toString(), {
		listener,
		author: {
			id: author.id.toString(),
			username: author.username,
			displayName: author.firstName + ' ' + author.lastName
		},
		channel: {
			forum: true,
			id: chatId.toString(),
			name: chat.title
		},
		id: message.id.toString(),
		text: message.rawText,
		reply: {
			author: {
				displayName: replyAuthor?.firstName + ' ' + replyAuthor?.lastName,
				id: replyAuthor?.id.toString(),
				username: replyAuthor?.username
			},
			id: reply?.id.toString(),
			text: reply?.rawText
		}
	});

	console.log(Store.messages);
};

async function onGroupMessage({ message, author, chatId, chat, listener }: HandlerArguments) {
	const user = listener.users?.find(user => user === author.username);
	if (listener.users?.length && !user) return;

	const files = await getFiles(message);

	if (!message.rawText && !files.length) return;

	const reply = await message.getReplyMessage() as Reply;
	const replyAuthor = await reply?.getSender() as Api.User;


	Store.add(chatId.toString(), {
		listener,
		author: {
			id: author.id.toString(),
			username: author.username,
			displayName: author.firstName + ' ' + author.lastName
		},
		channel: {
			forum: true,
			id: chatId.toString(),
			name: chat.title
		},
		id: message.id.toString(),
		text: message.rawText,
		reply: {
			author: {
				displayName: replyAuthor?.firstName + ' ' + replyAuthor?.lastName,
				id: replyAuthor?.id.toString(),
				username: replyAuthor?.username
			},
			id: reply?.id.toString(),
			text: reply?.rawText
		}
	});

	console.log(Store.messages);
	// Webhook.send(listener.webhook, {
	// 	username: listener.name,
	// 	content: [
	// 		replyAuthor && `> \`${replyAuthor.firstName}:\` ${getContent(reply)}`,
	// 		`${codeblock(author?.firstName ?? chat.title + ':')} ${getContent(message)}`
	// 	].filter(Boolean).join('\n')
	// }, files);
};

async function getFiles(message: Api.Message) {
	const files = [];

	if (!fs.existsSync(Paths.Files)) {
		fs.mkdirSync(Paths.Files);
	}

	const media = message.media as Api.MessageMediaPhoto;
	const document = message.media as Api.MessageMediaDocument;
	const photo = media?.photo;

	if (message.document?.fileReference || media || photo) {
		const payload = photo ?? document?.document ?? message.document as any;
		if (!payload) return files;

		Client._log.info(`Received media payload with mime type ${payload.mimeType}`);
		if (config.messages.attachments.ignore.includes(payload.mimeType)) {
			return files;
		}

		const media = await message.downloadMedia() as Buffer;
		const file = path.join(Paths.Files, uuid(30));

		fs.writeFileSync(file, media);

		const attribute = payload.attributes?.find(a => a.fileName);

		const name = attribute?.fileName ?? [
			path.basename(file),
			'.',
			mimeTypes.extension(payload.mimeType ?? 'image/png')
		].join('');

		files.push({ path: file, name, mimeType: payload.mimeType ?? 'image/png' });
	}

	return files;
}

function getContent(msg: Api.Message) {
	let content = msg.rawText;

	const entities = msg.entities?.filter(e => e.className === 'MessageEntityTextUrl') ?? [];
	const offsets = [];

	for (const entity of entities as (Api.TypeMessageEntity & { originalOffset: number; url: string; })[]) {
		const premades = offsets.filter(o => o.orig < entity.offset);
		entity.originalOffset = entity.offset;

		for (const premade of premades) entity.offset += premade.length;

		const name = content.substr(entity.offset, entity.length);
		if (name === entity.url || name.startsWith('http')) continue;

		const start = content.slice(0, entity.offset);
		const end = content.slice(entity.offset + entity.length);
		const replacement = name === entity.url ? entity.url : `[${name}](\<${entity.url}>)`;

		offsets.push({
			orig: entity.originalOffset,
			length: replacement.length - entity.length
		});

		content = start + replacement + end;
	}

	return content;
}