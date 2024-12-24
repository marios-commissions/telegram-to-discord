import { Client } from '~/structures';
import uuid from '~/utilities/uuid';
import { Paths } from '~/constants';
import mimeTypes from 'mime-types';
import config from '@config.json';
import { Api } from 'telegram';
import path from 'path';
import fs from 'fs';


async function getFiles(message: Api.Message) {
	const files = [];

	if (!fs.existsSync(Paths.Files)) {
		fs.mkdirSync(Paths.Files);
	}

	const media = message.media;
	const document = message.document;

	if (media?.className === 'MessageMediaWebPage') {
		return files;
	}

	if (document || media) {
		const payload = (document || media) as any;
		if (!payload) return files;

		Client._log.info(`Received media payload with mime type ${payload.className === 'MessageMediaPhoto' ? 'image/png' : payload.mimeType} `);
		if (config.messages.attachments.ignore.includes(payload.className === 'MessageMediaPhoto' ? 'image/png' : payload.mimeType)) {
			return files;
		}

		const buf = await message.downloadMedia() as Buffer;
		if (!buf?.length) return files;

		const id = uuid(30);
		const filePath = path.join(Paths.Files, id);

		if (config.messages.attachments.save) {
			fs.writeFileSync(filePath, buf);
		}

		const attrib = payload.attributes?.find(a => a.fileName)?.fileName;
		const file = id + '.' + (payload.mimeType ? payload.mimeType === 'audio/ogg' ? 'ogg' : mimeTypes.extension(payload.mimeType) : 'png');

		files.push({ path: filePath, name: attrib ?? file, buffer: buf, mimeType: payload.mimeType || 'image/png' });
	}

	return files;
}

export default getFiles;