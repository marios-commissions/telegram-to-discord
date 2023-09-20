import { colorize } from '@utilities';
import config from '@config';

export function log(...args: string[]): void {
	return console.log('»', ...args);
}

export function error(...args: string[]): void {
	return console.error(colorize('»', 'red'), ...args);
}

export function success(...args: string[]): void {
	return console.log(colorize('»', 'green'), ...args);
}

export function warn(...args: string[]): void {
	return console.warn(colorize('»', 'yellow'), ...args);
}

export function debug(...args: string[]): void {
	if (!config.debug) return;

	return console.debug(colorize('»', 'gray'), ...args);
}

export function info(...args: string[]): void {
	return console.info(colorize('»', 'blue'), ...args);
}

export function createLogger(...callers: string[]) {
	const prefix = callers.join(' → ') + ':';

	return {
		log: (...args) => log(prefix, ...args),
		error: (...args) => error(prefix, ...args),
		success: (...args) => success(prefix, ...args),
		warn: (...args) => warn(prefix, ...args),
		debug: (...args) => debug(prefix, ...args),
		info: (...args) => info(prefix, ...args),
	};
}