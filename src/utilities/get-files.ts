import { Api } from 'telegram';

async function getFiles(message: Api.Message) {
	let files = 0;

	const media = message.media;
	const document = message.document;

	if (document) {
		files++;
	}

	if (media && media.className !== 'MessageMediaWebPage') {
		files++;
	}

	return files;
}

export default getFiles;