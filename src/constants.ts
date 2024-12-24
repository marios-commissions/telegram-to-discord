import type { TelegramClientParams } from 'telegram/client/telegramBaseClient';
import path from 'path';


export const Paths = {
	Files: path.join(__dirname, '..', 'files'),
	Database: path.join(__dirname, '..', 'db.sqlite')
};

export const ClientOptions: TelegramClientParams = {
	autoReconnect: true,
	connectionRetries: Infinity,
	useWSS: true
};

export const SessionName = '.keepsecret';