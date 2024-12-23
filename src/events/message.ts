import type { Chat, Reply, Listener } from '~/typings/structs';
import { EditedMessage } from 'telegram/events/EditedMessage';
import { codeblock, getContent, getFiles } from '~/utilities';
import type { NewMessageEvent } from 'telegram/events';
import { type APIEmbed } from 'discord-api-types/v10';
import { Client, Webhook } from '~/structures';
import { NewMessage } from 'telegram/events';
import { Api } from 'telegram';
import config from '~/config';


Client.addEventHandler(onMessage, new NewMessage());

Client.addEventHandler((event) => {
	// @ts-expect-error
	event.message._edit = new Date();
	onMessage(event);
}, new EditedMessage({}));

// Constants
const SCAN_HISTORY_LIMIT = 10;
const TRADE_HISTORY_LIMIT = 100;

// Cache sets
const recentScans = new Set<string>();
const recentTrades = new Set<string>();

// Token mapping
const PRIMARY_TOKENS = {
	'#WETH': 'ETH',
	'#ETH': 'ETH',
	'#SOL': 'SOL',
	'#USDC': 'USD',
	'#USDT': 'USD',
	'#WMATIC': 'MATIC',
	'#FTM': 'FTM',
	'#BNB': 'BNB'
} as const;

// Address patterns for different chains
const ADDRESS_PATTERNS = {
	ethereum: /\b0x[a-fA-F0-9]{40}\b/g,
	solana: [
		/[A-Za-z0-9]{39,40}pump/g,
		/\b[A-Za-z0-9]{44}\b/g,
		/\b[A-Za-z0-9]{43}\b/g
	],
	ton: /\bE[A-Za-z0-9_-]{47}\b/g,
	tron: /\bT[A-Za-z0-9_-]{33}\b/g,
	cardano: /\b[A-Za-z0-9]{56}\b/g
} as const;

interface ProcessedMessage {
	type: string;
	context: {
		wallet_address: string;
		username: string;
		amount?: number;
		currency?: string;
		url: string;
		args: string;
	};
}

function getAddress(message: string): [string | null, string | null] {
	const CASHTAG_PATTERN = /\$\w+/g;

	// Check for blockchain addresses
	for (const [chain, patterns] of Object.entries(ADDRESS_PATTERNS)) {
		if (Array.isArray(patterns)) {
			for (const pattern of patterns) {
				const matches = [...message.matchAll(pattern)].map(match => match[0]);
				if (matches.length) {
					return [getMostFrequent(matches), chain];
				}
			}
		} else {
			const matches = [...message.matchAll(patterns as RegExp)].map(match => match[0]);
			if (matches.length) {
				return [getMostFrequent(matches), chain];
			}
		}
	}

	// Check for cashtags if no address found
	const cashtags = [...message.matchAll(CASHTAG_PATTERN)].map(match => match[0]);
	if (cashtags.length) {
		return [cashtags[0].slice(1), "cashtag"];
	}

	return [null, null];
}

function getMostFrequent<T>(arr: T[]): T {
	return arr.reduce((a, b) =>
		arr.filter(v => v === a).length >= arr.filter(v => v === b).length ? a : b
	);
}

function getWalletAddress(message: Api.Message): string | null {
	const addresses = message.entities
		?.filter(entity => entity.className === 'MessageEntityTextUrl')
		?.map(entity => entity.url?.split('/')?.pop())
		?.filter(Boolean) || [];

	return addresses[0] || null;
}

function processCielo(message: Api.Message, tokenAddress: string): ProcessedMessage | null {
	const pattern = /(\d+(?:,\d+)*(?:\.\d+)?) (#\w+)/g;
	const hashtagEntities = [...message.message.matchAll(pattern)];

	if (!hashtagEntities.length) return null;

	const hashEntity = hashtagEntities[0][2] || '';
	const walletAddress = getWalletAddress(message);
	if (!walletAddress) return null;

	const walletLabel = message.message
		.split('\n')[0]
		.replace(/[#= ]/g, '')
		.replace(/\+/g, '_');

	let type: 'buy' | 'sell';
	let amount: number;
	let currency: string;

	if (PRIMARY_TOKENS[hashEntity as keyof typeof PRIMARY_TOKENS]) {
		type = 'buy';
		amount = parseFloat(hashtagEntities[0][1].replace(/,/g, ''));
		currency = PRIMARY_TOKENS[hashEntity as keyof typeof PRIMARY_TOKENS];
	} else {
		type = 'sell';
		const lastEntity = hashtagEntities[hashtagEntities.length - 1];
		amount = parseFloat(lastEntity[1].replace(/,/g, ''));
		currency = PRIMARY_TOKENS[lastEntity[2] as keyof typeof PRIMARY_TOKENS] || 'UNKNOWN';
	}

	const uid = `${walletAddress}:${tokenAddress}`.toLowerCase();
	if (recentTrades.has(uid)) return null;

	// Update trade history
	recentTrades.add(uid);
	if (recentTrades.size > TRADE_HISTORY_LIMIT) {
		const firstItem = recentTrades.values().next().value;
		recentTrades.delete(firstItem);
	}

	return {
		type,
		context: {
			wallet_address: walletAddress,
			username: walletLabel,
			amount,
			currency,
			url: `https://app.cielo.finance/profile/${walletAddress}?tokens=${tokenAddress}`,
			args: message.message
		}
	};
}

async function processMessage(
	chatId: string | number,
	username: string,
	guildname: string,
	message: Api.Message,
	incomingType?: string
): Promise<void> {
	const messageText = message.message || '';
	const textWithLinks = message.entities
		?.filter(entity => entity.className === 'MessageEntityTextUrl')
		?.map(entity => entity.url?.split('/')?.pop())
		?.filter(Boolean) || [];

	const fullMessage = [messageText, ...textWithLinks].join(' ');
	const [address, chain] = getAddress(fullMessage);

	if (!address) return;

	const scanKey = `${username}:${address}`.toLowerCase();
	if (recentScans.has(scanKey)) return;

	// Update scan history
	recentScans.add(scanKey);
	if (recentScans.size > SCAN_HISTORY_LIMIT) {
		const firstItem = recentScans.values().next().value;
		recentScans.delete(firstItem);
	}

	// Determine message type
	const type = incomingType || (
		username.toLowerCase().includes('bot') ? 'bot' :
			['call', 'gamble', 'playground'].some(keyword =>
				guildname.toLowerCase().includes(keyword)
			) ? 'caller' : 'scan'
	);

	// Process message context
	const context = fullMessage.toLowerCase().includes('cielo')
		? processCielo(message, address)?.context
		: {
			username,
			guildname,
			url: `https://t.me/c/${String(chatId).replace('-100', '')}/${message.id}`,
			args: messageText,
		};

	if (!context) return;

	const payload = { type, chain, token_address: address, context };

	try {
		await fetch('https://istory.ai/create/history', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});
		console.log(`Found ${chain} address: ${address} from ${username} (${guildname})\n ${JSON.stringify(payload)}`);
	} catch (err) {
		console.error('Failed to send to istory.ai:', err);
	}
}

async function onMessage({ message, chatId }: NewMessageEvent) {
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
		if (listener.blacklistedUsers && usernames.some(u => listener.blacklistedUsers.includes(u))) {
			return false;
		}

		if (listener.hasContent?.length && !listener.hasContent.every(c => message.rawText?.includes(c))) {
			return false;
		}

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
		message._edit ? `__**Edited: ${message._edit.toLocaleString()}**__` : '',
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

	const username = listener.includeForumChannelName ? channel.name : author?.username || author?.firstName || '';
	const guildname = chat?.title || '';
	const type = listener.type;
	await processMessage(chatId.toString(), username, guildname, message, type);
}

async function onLinkedMessage({ chatId, message, author, chat, usernames, listener }: HandlerArguments) {
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
		message._edit ? `__**Edited: ${message._edit.toLocaleString()}**__` : '',
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

	const username = listener.includeForumChannelName ? chat.title : author?.username || author?.firstName || '';
	const guildname = chat?.title || '';
	const type = listener.type;
	await processMessage(chatId.toString(), username, guildname, message, type);
}

async function onGroupMessage({ chatId, message, author, usernames, chat, listener }: HandlerArguments) {
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
		message._edit ? `__**Edited: ${message._edit.toLocaleString()}**__` : '',
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

	const username = listener.includeForumChannelName ? chat.title : author?.username || author?.firstName || '';
	const guildname = chat?.title || '';
	const type = listener.type;
	await processMessage(chatId.toString(), username, guildname, message, type);
}
