export class Logger {
	constructor(
		private readonly prefix: string,
		private readonly isDebugEnabled: () => boolean,
	) {}

	debug(message: string, ...data: unknown[]): void {
		if (IS_DEV || this.isDebugEnabled()) {
			console.log(`${this.prefix} ${message}`, ...data);
		}
	}

	warn(message: string, ...data: unknown[]): void {
		if (IS_DEV || this.isDebugEnabled()) {
			console.warn(`${this.prefix} ${message}`, ...data);
		}
	}

	error(message: string, ...data: unknown[]): void {
		console.error(`${this.prefix} ${message}`, ...data);
	}
}
