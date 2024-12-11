import type { Listener } from '~/typings/structs';
import { escape } from '~/utilities';
import { Api } from 'telegram';
import config from '~/config';


function getContent(msg: Api.Message, listener?: Listener, channel?: any) {
	let content = msg.rawText;

	const entities = (msg.entities?.filter(e => e.className === 'MessageEntityTextUrl') ?? []).sort((a, b) => b.offset - a.offset);
	const offsets = [];

	const areLinksAllowed = config.messages?.embeds || (channel?.embeds ?? listener.embeds);

	for (const entity of entities as (Api.TypeMessageEntity & { originalOffset: number; url: string; })[]) {
		const premades = offsets.filter(o => o.orig < entity.offset);
		entity.originalOffset = entity.offset;

		for (const premade of premades) entity.offset += premade.length;

		const name = content.substr(entity.offset, entity.length);
		if (name === entity.url || name.startsWith('http')) continue;

		const start = content.slice(0, entity.offset);
		const end = content.slice(entity.offset + entity.length);

		const areLinksAllowedForCurrentEntity = ((listener.allowedEmbeds || config.messages?.allowedEmbeds) ?? []).some(allowed => ~entity.url.indexOf(allowed));
		const replacement = name === entity.url ? entity.url : `[${name}](${(areLinksAllowed || areLinksAllowedForCurrentEntity) ? entity.url : ('<' + entity.url + '>')})`;

		offsets.push({
			orig: entity.originalOffset ?? entity.offset,
			length: replacement.length - entity.length
		});

		content = start + replacement + end;
	}

	const replacements = { ...(config.messages?.replacements ?? {}), ...(listener.replacements ?? {}) };
	if (Object.keys(replacements).length) {
		for (const [subject, replacement] of Object.entries(replacements)) {
			content = content.replaceAll(subject, replacement);
		}
	}

	if (!areLinksAllowed) {
		const links = content?.match(/^(?!<)https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&\/\/=]*)/gmi);

		if (links?.length) {
			for (const link of links) {
				const areLinksAllowedForCurrentEntity = (config.messages?.allowedEmbeds ?? []).some(allowed => ~link.indexOf(allowed));

				if (!areLinksAllowedForCurrentEntity) {
					content = content.replaceAll(link, `<${link}>`);
				}
			}
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