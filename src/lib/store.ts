import type { StoredMessage } from '@typings/structs';
import EventEmitter from 'node:events';
import { debounce } from '@utilities';
import fsp from 'node:fs/promises';
import path from 'node:path';
import fs from 'node:fs';

class Store extends EventEmitter {
	messages: StoredMessage[] = [];

	constructor(
		public file: string
	) {
		super();

		this.save = debounce(this.save, 300);
		if (!fs.existsSync(file)) return this;

		const content = fs.readFileSync(file, 'utf-8');

		try {
			this.messages = JSON.parse(content) as StoredMessage[];
		} catch (e) {
			console.error(`Reading the messages file failed:`, e);
		}
	}

	async save() {
		try {
			const content = JSON.stringify(this.messages, null, 2);

			await fsp.writeFile(this.file, content, 'utf-8');
			this.emit('saved');
		} catch (e) {
			console.error(`Failed saving messages:`, e);
		}
	}

	add(message: StoredMessage) {
		if (!message.reply?.id) {
			delete message.reply;
		}

		this.messages.push(message);
		this.emit('changed');

		this.save();
	}

	delete() {
		this.messages = [];

		fs.rmSync(this.file);
	}
}

export default new Store(path.resolve(__dirname, '..', '..', 'messages.json'));