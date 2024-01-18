import mimeTypes from 'mime-types';
import { Paths } from '@constants';
import uuid from '@utilities/uuid';
import Client from '@lib/client';
import { Api } from 'telegram';
import config from '@config';
import path from 'path';
import fs from 'fs';

async function getFiles(message: Api.Message) {
	const files = [];

	if (!fs.existsSync(Paths.Files)) {
		fs.mkdirSync(Paths.Files);
	}

	const media = message.media as Api.MessageMediaPhoto;
	const document = message.media as Api.MessageMediaDocument;
	const photo = media?.photo;

	if (message.document?.fileReference || photo) {
		const payload = photo ?? document?.document ?? message.document as any;
		if (!payload) return files;

		Client._log.info(`Received media payload with mime type ${payload.mimeType}`);
		if (config.messages.attachments.ignore.includes(payload.mimeType)) {
			return files;
		}

		const media = await message.downloadMedia() as Buffer;
		const file = path.join(Paths.Files, uuid(30));

		if (config.messages.attachments.save) {
			fs.writeFileSync(file, media);
		}

		const attribute = payload.attributes?.find(a => a.fileName);

		const name = attribute?.fileName || [
			path.basename(file),
			'.',
			mimeTypes.extension(payload.mimeType ?? 'image/png')
		].join('');

		files.push({ path: file, name, mimeType: payload.mimeType ?? 'image/png' });
	}

	return files;
}

export default getFiles;