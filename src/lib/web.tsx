import { createLogger } from '@lib/logger';
import { WebSocketServer } from 'ws';
import { Store } from '@lib';

const Logger = createLogger('Web');

const ws = new WebSocketServer({ port: 8098 });

ws.on('connection', (socket) => {
	Logger.info('Client connected to WebSocket server.');

	function callback() {
		const messages = JSON.stringify(Store.messages);
		socket.send(messages);
	}


	Store.on('changed', callback);
	ws.on('message', callback);
	ws.on('error', console.error);
	ws.on('close', () => {
		Logger.info('Client disconnected from WebSocket server.');
		Store.off('changed', callback);
	});

	callback();
});

ws.on('listening', () => {
	Logger.success('WebSocket server listening on port 8098');
});