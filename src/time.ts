export const DAY = 86400;

export type Period = "daily" | "weekly";

export function dayNumber(time: number): number {
	return math.floor(time / DAY);
}

// unix day 0 (1970-01-01) was a thursday, shifting by 3 days makes every week start monday 00:00 utc
export function weekNumber(time: number): number {
	return math.floor((dayNumber(time) + 3) / 7);
}

export function periodNumber(period: Period, time: number): number {
	return period === "daily" ? dayNumber(time) : weekNumber(time);
}

export function nextReset(period: Period, time: number): number {
	return period === "daily" ? (dayNumber(time) + 1) * DAY : ((weekNumber(time) + 1) * 7 - 3) * DAY;
}
