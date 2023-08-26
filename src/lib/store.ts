import type { StoredMessage } from '@typings/structs';
import EventEmitter from 'node:events';
import fsp from 'node:fs/promises';
import path from 'node:path';
import fs from 'node:fs';
import { debounce } from '@utilities';

class Store extends EventEmitter {
	messages: Record<string, StoredMessage[]> = {};

	constructor(
		public dir: string
	) {
		super();

		this.save = debounce(this.save, 300);

		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir);
			return this;
		}

		const chats = fs.readdirSync(dir, { withFileTypes: false });

		for (const chat of chats) {
			try {
				const file = path.resolve(dir, chat);
				const content = fs.readFileSync(file, 'utf-8');

				this.messages[chat as string] ??= [];
				this.messages[chat as string].push(JSON.parse(content) as StoredMessage);
			} catch (e) {
				console.error(`Skipping chat ${chat} as reading the file failed:`, e);
			}
		}
	}

	async save() {
		if (!fs.existsSync(this.dir)) await fsp.mkdir(this.dir);

		for (const id in this.messages) {
			try {
				const chatId = path.resolve(this.dir, id + '.json');
				const messages = this.messages[id];
				const content = JSON.stringify(messages, null, 2);

				await fsp.writeFile(chatId, content, 'utf-8');
				this.emit('saved-chat', id);
			} catch (e) {
				console.error(`Failed saving chat ${id}:`, e);
			}
		}

		this.emit('saved');
	}

	add(chat: string, message: StoredMessage) {
		if (!message.reply?.id) {
			delete message.reply;
		}

		this.messages[chat] ??= [];
		this.messages[chat].push(message);
		this.emit('changed');

		this.save();
	}

	delete() {
		this.messages = {};

		fs.rmdirSync(this.dir, { recursive: true });
		fs.mkdirSync(this.dir);
	}
}

export default new Store(path.resolve(__dirname, '..', '..', 'messages'));