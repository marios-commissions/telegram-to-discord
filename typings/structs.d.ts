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
	users?: string[];
	name: string;
	group: string;
	remove?: string[];
	forum?: boolean;
	stickers?: boolean;
	webhook?: string;
	pins?: boolean;
	embeds?: boolean;
	embedded?: boolean;
	embedColor?: number;
	channels?: {
		name?: string;
		main?: boolean;
		webhook: string;
	}[];
}