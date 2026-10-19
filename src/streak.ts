export interface StreakState {
	readonly lastDay: number;
	readonly current: number;
	readonly best: number;
}

// Saved means days were missed but fewer than the grace allows, so the streak carried on anyway
export type StreakStatus = "Started" | "SameDay" | "Continued" | "Saved" | "Broken";

export interface StreakUpdate {
	readonly status: StreakStatus;
	readonly missedDays: number;
	readonly state: StreakState;
}

export function advanceStreak(previous: StreakState | undefined, day: number, graceDays: number): StreakUpdate {
	if (previous === undefined) {
		return { status: "Started", missedDays: 0, state: { lastDay: day, current: 1, best: 1 } };
	}

	// a clock that went backwards (or a second login today) never touches the streak
	if (day <= previous.lastDay) {
		return { status: "SameDay", missedDays: 0, state: previous };
	}

	const missedDays = day - previous.lastDay - 1;
	let status: StreakStatus;
	let current: number;
	if (missedDays === 0) {
		status = "Continued";
		current = previous.current + 1;
	} else if (missedDays <= graceDays) {
		status = "Saved";
		current = previous.current + 1;
	} else {
		status = "Broken";
		current = 1;
	}

	return { status, missedDays, state: { lastDay: day, current, best: math.max(previous.best, current) } };
}
