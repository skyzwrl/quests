export class Listeners<T extends unknown[]> {
	private readonly listeners: ((...args: T) => void)[] = [];

	public add(listener: (...args: T) => void): () => void {
		this.listeners.push(listener);
		return () => {
			const index = this.listeners.indexOf(listener);
			if (index !== -1) {
				this.listeners.remove(index);
			}
		};
	}

	public fire(...args: T): void {
		if (this.listeners.isEmpty()) {
			return;
		}
		// a listener may disconnect itself or others while this runs
		for (const listener of table.clone(this.listeners)) {
			listener(...args);
		}
	}
}
