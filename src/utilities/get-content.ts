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

	const variables = {
		text: content
	};

	const formatting = new RegExp(`{{\\s*(${Object.keys(variables).join('|')})\\s*}}`, 'gmi');

	const replacements: Record<string, string> = { ...(config.messages?.replacements ?? {}), ...(listener.replacements ?? {}) };

	if (Object.keys(replacements).length) {
		for (const [subject, replacement] of Object.entries(replacements)) {
			content = content.replaceAll(subject, replacement.replace(formatting, (_, group) => variables[group]));
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