/**
 * A function for splitting a string into fixed-length parts. Designed as a
 * workaround to an issue in the discord.js Util.splitMessage function
 * https://github.com/discordjs/discord.js/issues/7674
 * @param {string} text The string to split into multiple messages, each of
 * which will be no longer than maxLength
 * @param {object} [options]
 * @param {number} [options.maxLength] The maximum number of characters in each
 * string in the returned array
 * @param {RegExp} [options.regex] A global regex which matches the delimeters on
 * which to split text when needed to keep each part within maxLength
 * @param {string} [options.prepend] A string to add before each part iff
 * text is split into multiple parts
 * @param {string} [options.append] A string to add after each part iff text
 * is split into multiple parts
 * @returns {string[]} An array of strings which are substrings of text, split
 * using options.regex, combined such that each part is as long as possible
 * while not exceeding options.maxLength.
 */

function splitMessage(text, { maxLength = 2_000, regex = /\n/g, prepend = '', append = '' } = {}) {
	if (text.length <= maxLength) return [text];

	const parts = [];
	let curPart = prepend;
	let chunkStartIndex = 0;

	let prevDelim = '';

	function addChunk(chunkEndIndex, nextDelim) {
		const nextChunk = text.substring(chunkStartIndex, chunkEndIndex);
		const nextChunkLen = nextChunk.length;

		// If a single part would exceed the length limit by itself, throw an error:
		if (prepend.length + nextChunkLen + append.length > maxLength) {
			throw new RangeError('SPLIT_MAX_LEN');
		}

		// The length of the current part if the next chunk were added to it:
		const lengthWithChunk = (
			curPart.length + prevDelim.length + nextChunkLen + append.length
		);

		// If adding the next chunk to the current part would cause it to exceed
		// the maximum length, push the current part and reset it for next time:
		if (lengthWithChunk > maxLength) {
			parts.push(curPart + append);
			curPart = prepend + nextChunk;
		}
		else {
			curPart += prevDelim + nextChunk;
		}
		prevDelim = nextDelim;
		chunkStartIndex = chunkEndIndex + prevDelim.length;
	}

	for (const match of text.matchAll(regex)) {
		addChunk(match.index, match[0]);
	}
	addChunk(text.length - 1, '');
	parts.push(curPart + append);
	return parts;
}

export default splitMessage;