import { createLogger } from '~/structures/logger';
import { Paths } from '~/constants';
import { Database } from 'sqlite3';


const database = new Database(Paths.Database);
const logger = createLogger('Database');

export async function init(): Promise<void> {
	logger.info('Starting database initialization...');

	try {
		logger.info('Attempting to create messages table...');

		await database.run(`
      CREATE TABLE IF NOT EXISTS messages (
        chatId TEXT NOT NULL,
        messageId TEXT NOT NULL,
        contentHash TEXT NOT NULL,
        PRIMARY KEY (chatId, messageId)
      );
    `);

		logger.success('Table creation completed.');

		// Check if table exists
		logger.info('Verifying table creation...');

		await database.get(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='messages';
		`);

		logger.success('Table exists.');
	} catch (error) {
		logger.error('Database error details:', {
			error,
			stack: error.stack,
			message: error.message
		});

		throw error;
	}
}

/**
 * Find a message hash by chatId and messageId
 * @param chatId The chat identifier
 * @param messageId The message identifier
 * @returns Promise<string | null> The content hash if found, null otherwise
 */
export function findMessageHash(chatId: string, messageId: string): Promise<string | null> {
	return new Promise((resolve, reject) => {
		database.get(
			'SELECT contentHash FROM messages WHERE chatId = ? AND messageId = ?',
			[chatId, messageId],
			(err, row: { contentHash: string; } | undefined) => {
				if (err) {
					reject(err);
					return;
				}
				resolve(row ? row.contentHash : null);
			}
		);
	});
}

/**
 * Insert or update a message hash
 * @param chatId The chat identifier
 * @param messageId The message identifier
 * @param contentHash The content hash to store
 * @returns Promise<void>
 */
export function insertMessageHash(chatId: string, messageId: string, contentHash: string): Promise<void> {
	return new Promise((resolve, reject) => {
		database.run(
			'INSERT OR REPLACE INTO messages (chatId, messageId, contentHash) VALUES (?, ?, ?)',
			[chatId, messageId, contentHash],
			(err) => {
				if (err) {
					reject(err);
					return;
				}
				resolve();
			}
		);
	});
}

// Create index for better query performance
database.run('CREATE INDEX IF NOT EXISTS idx_messages_lookup ON messages(chatId, messageId)');

export default database;