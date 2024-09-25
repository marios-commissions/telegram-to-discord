import type { Listener } from '~/typings/structs';
import { escape } from '~/utilities';
import { Api } from 'telegram';
import config from '~/config';

function getContent(msg: Api.Message, listener?: Listener, channel?: any) {
	let content = msg.rawText;

	const entities = (msg.entities?.filter(e => e.className === 'MessageEntityUrl') ?? []).sort((a, b) => b.offset - a.offset);
	const offsets = [];

	for (const entity of entities as (Api.TypeMessageEntity & { originalOffset: number; url: string; })[]) {
		console.log(entity);
		const premades = offsets.filter(o => o.orig < entity.offset);
		entity.originalOffset = entity.offset;

		for (const premade of premades) entity.offset += premade.length;

		const name = content.substr(entity.offset, entity.length);

		const start = content.slice(0, entity.offset);
		const end = content.slice(entity.offset + entity.length);

		const url = new URL(name);

		const replacement = `(link to ${url.host})`;

		offsets.push({
			orig: entity.originalOffset ?? entity.offset,
			length: replacement.length - entity.length
		});

		content = start + replacement + end;
	}

	if (config.replacements.length) {
		for (const { pattern, replacement } of config.replacements) {
			const regex = new RegExp(pattern, 'gmi');
			content = content.replaceAll(regex, replacement);
		}
	}

	if (listener.remove?.length) {
		for (const removal of listener.remove) {
			const escaped = escape(removal).replaceAll('\\*', '([^\\s]+)');
			const regex = new RegExp(escaped, 'gmi');

			content = content.replaceAll(regex, '');
		}
	}

	return content;
}

export default getContent;