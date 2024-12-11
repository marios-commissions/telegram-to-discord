import { Api } from 'telegram';


export type Chat = {
	forum: boolean;
} & Api.Chat;

export type Reply = {
	action: ReplyAction;
} & Api.Message;

export type ReplyAction = {
	title: string;
} & Api.TypeMessageAction;

export interface Listener {
	type?: string;
	users?: string[];
	commands?: boolean;
	includeForumChannelName?: boolean;
	blacklistedUsers?: string[];
	hasContent?: string[];
	excludeEmptyMessages?: boolean;
	forwardTo?: string;
	whitelist?: string[];
	blacklist?: string[];
	whitelistOnly?: boolean;
	linked?: boolean;
	replyingTo?: string[];
	dontEmbedSingularLinks?: boolean;
	name: string;
	repliesOnly?: boolean;
	group: string;
	remove?: string[];
	forum?: boolean;
	stickers?: boolean;
	webhook?: string;
	pins?: boolean;
	embeds?: boolean;
	embedded?: boolean | string[];
	allowDMs?: boolean;
	showUser?: boolean;
	showReplies?: boolean;
	useReplyUserInsteadOfAuthor?: boolean;
	mention?: boolean;
	embedColor?: number;
	extraWebhookParameters?: any[];
	channels?: {
		name?: string;
		main?: boolean;
		webhook: string;
	}[];
}