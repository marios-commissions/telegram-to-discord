import { WebSocketServer } from 'ws';
import Client from '~/lib/client';
import { Store } from '~/lib';

const ws = new WebSocketServer({ port: 8098 });

ws.on('connection', (socket) => {
	Client.logger.info('Client connected to WebSocket server.');

	function callback() {
		const sorted = Store.messages.slice(-250).sort((a, b) => a.time - b.time);
		const data = JSON.stringify({ type: 'MESSAGES_UPDATE', data: sorted ?? [] });

		socket.send(data);
	}

	Store.on('changed', callback);
	socket.on('error', console.error);

	socket.on('message', (data) => {
		try {
			const payload = JSON.parse(data.toString());

			switch (payload.type) {
				case 'DELETE':
					if (payload.password !== process.env.PASSWORD) {
						return socket.send(JSON.stringify({ type: 'DELETE_FAILED' }));
					}

					Store.delete();
					socket.send(JSON.stringify({ type: 'DELETE_SUCCESS' }));
					break;
			}
		} catch (error) {
			Client.logger.error('Failed to handle payload:' + ' ' + data.toString() + ' ' + error);
		}
	});

	socket.on('close', () => {
		Client.logger.info('Client disconnected from WebSocket server.');
		Store.off('changed', callback);
	});

	callback();
});

ws.on('listening', () => {
	Client.logger.info('WebSocket server listening on port 8098');
});