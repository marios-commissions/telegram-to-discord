/**
 * @name codeblock
 * @description Wraps a string in a Discord code block.
 * @param {string} [contents] - The length of the randomized UUID
 * @return {string} Returns the string that was passed, wrapped in a code block.
 */

function codeblock(contents: string) {
	return '`' + contents + '`';
}

export default codeblock;