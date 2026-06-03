/**
 * Fires onIdle after a period of inactivity. Each notifyActivity() call resets
 * the timer, so typing repeatedly postpones (and effectively cancels) the
 * pending idle callback.
 */
export class IdleDetector {
	private timer: number | null = null;
	private running = false;

	constructor(
		private idleMs: number,
		private onIdle: () => void,
	) {}

	notifyActivity(): void {
		if (this.timer !== null) {
			window.clearTimeout(this.timer);
			this.timer = null;
		}
		if (!this.running) {
			return;
		}
		this.timer = window.setTimeout(() => {
			this.timer = null;
			this.onIdle();
		}, this.idleMs);
	}

	start(): void {
		this.running = true;
	}

	stop(): void {
		this.running = false;
		if (this.timer !== null) {
			window.clearTimeout(this.timer);
			this.timer = null;
		}
	}

	setIdleMs(idleMs: number): void {
		this.idleMs = idleMs;
	}
}
