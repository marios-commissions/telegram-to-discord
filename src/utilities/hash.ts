import { createHash } from 'node:crypto';


/**
 * Generates a SHA-256 hash of the a string
 * @param {string} content - The content to hash
 * @returns {string} The hexadecimal hash of the content
 */
function hash(content: string) {
	return createHash('sha256')
		.update(content)
		.digest('hex');
}

export default hash;