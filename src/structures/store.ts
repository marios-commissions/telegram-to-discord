import type { Message } from '~/typings/structs';
import EventEmitter from 'node:events';

class Store extends EventEmitter {
	messages: Array<Message> = [];

	add(message: Omit<Message, 'origin'>) {
		(message as Message).origin ??= 'telegram';

		this.messages.push(message as Message);
		this.emit('changed');
	}
}

export default new Store();