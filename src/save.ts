import { CatalogQuest, QuestCatalog } from "./catalog";
import { isFiniteNumber, isWholeAtLeast } from "./numbers";
import { isComplete } from "./objectives";
import { AchievementState, QuestState, QuestStatus } from "./state";
import { StreakState } from "./streak";
import { periodNumber } from "./time";

export const SAVE_VERSION = 1;

const STATUSES: readonly QuestStatus[] = ["Active", "Completed", "Claimed"];
const STATUS_CODES: Record<QuestStatus, number> = { Active: 0, Completed: 1, Claimed: 2 };

// tuples keep saves small: status code, period, then progress per objective, which is dropped once claimed
export type SavedQuest = [status: number, period: number, ...progress: number[]];
export type SavedAchievement = [progress: number, tier: number];
export type SavedStreak = [lastDay: number, current: number, best: number];

export interface SaveData {
	readonly version: number;
	readonly quests: { readonly [id: string]: SavedQuest };
	readonly achievements: { readonly [id: string]: SavedAchievement };
	readonly streak?: SavedStreak;
}

export interface TrackerState {
	readonly quests: Map<string, QuestState>;
	readonly achievements: Map<string, AchievementState>;
	readonly streak?: StreakState;
}

export type ReadResult =
	| { readonly ok: true; readonly state: TrackerState; readonly problems: string[] }
	| { readonly ok: false; readonly reason: string };

export function writeSave(state: TrackerState): SaveData {
	const quests: { [id: string]: SavedQuest } = {};
	for (const [id, quest] of state.quests) {
		const entry: SavedQuest = [STATUS_CODES[quest.status], quest.period];
		if (quest.status !== "Claimed") {
			for (const value of quest.progress) {
				entry.push(value);
			}
		}
		quests[id] = entry;
	}

	const achievements: { [id: string]: SavedAchievement } = {};
	for (const [id, achievement] of state.achievements) {
		if (achievement.progress !== 0 || achievement.tier !== 0) {
			achievements[id] = [achievement.progress, achievement.tier];
		}
	}

	const streak = state.streak;
	return {
		version: SAVE_VERSION,
		quests,
		achievements,
		streak: streak !== undefined ? [streak.lastDay, streak.current, streak.best] : undefined,
	};
}

function readProgress<R>(quest: CatalogQuest<R>, entry: readonly unknown[], problems: string[]): number[] {
	const id = quest.definition.id;
	const leaves = quest.objective.leaves;
	const progress: number[] = [];

	if (entry.size() - 2 !== leaves.size()) {
		problems.push(`reset progress of "${id}", its objectives changed`);
		for (let index = 0; index < leaves.size(); index++) {
			progress.push(0);
		}
		return progress;
	}

	let repaired = false;
	for (const leaf of leaves) {
		const value = entry[leaf.index + 2];
		const fixed = isFiniteNumber(value) ? math.clamp(value, 0, leaf.target) : 0;
		repaired ||= fixed !== value;
		progress.push(fixed);
	}
	if (repaired) {
		problems.push(`clamped progress of "${id}" to its objectives`);
	}
	return progress;
}

function readQuest<R>(
	quest: CatalogQuest<R>,
	entry: readonly unknown[],
	now: number,
	problems: string[],
): QuestState | undefined {
	const id = quest.definition.id;
	const code = entry[0];
	const status = isWholeAtLeast(code, 0) ? STATUSES[code] : undefined;
	const period = entry[1];
	if (status === undefined || !isWholeAtLeast(period, 0)) {
		problems.push(`dropped quest "${id}", its entry was malformed`);
		return undefined;
	}

	const repeats = quest.definition.repeats;
	if (repeats !== undefined && period !== periodNumber(repeats, now)) {
		// taken in an earlier day or week, it would have reset anyway
		return undefined;
	}

	let progress: number[];
	let finalStatus = status;
	if (status === "Claimed") {
		progress = quest.objective.leaves.map((leaf) => leaf.target);
	} else {
		progress = readProgress(quest, entry, problems);
		if (isComplete(quest.objective.root, progress)) {
			finalStatus = "Completed";
		} else if (status === "Completed") {
			finalStatus = "Active";
			problems.push(`"${id}" was saved as completed but its objectives aren't, set it back to active`);
		}
	}

	return { status: finalStatus, period: repeats !== undefined ? period : 0, progress };
}

// anything that would start the player from nothing is a hard failure, so the caller can refuse to load
// instead of saving an empty tracker over real data. damage to single entries gets repaired and reported
export function readSave<R>(catalog: QuestCatalog<R>, data: unknown, now: number): ReadResult {
	const quests = new Map<string, QuestState>();
	const achievements = new Map<string, AchievementState>();
	const problems: string[] = [];

	if (data === undefined) {
		return { ok: true, state: { quests, achievements }, problems };
	} else if (!typeIs(data, "table")) {
		return { ok: false, reason: `expected a table, got ${typeOf(data)}` };
	}

	const saved = data as { version?: unknown; quests?: unknown; achievements?: unknown; streak?: unknown };
	if (saved.version !== SAVE_VERSION) {
		return { ok: false, reason: `unsupported save version ${tostring(saved.version)}` };
	}

	if (typeIs(saved.quests, "table")) {
		for (const [id, entry] of pairs(saved.quests as Record<string, unknown>)) {
			const quest = typeIs(id, "string") ? catalog.getQuest(id) : undefined;
			if (quest === undefined) {
				problems.push(`dropped unknown quest ${tostring(id)}`);
			} else if (!typeIs(entry, "table")) {
				problems.push(`dropped quest "${id}", its entry was malformed`);
			} else {
				const state = readQuest(quest, entry as unknown[], now, problems);
				if (state !== undefined) {
					quests.set(id, state);
				}
			}
		}
	} else if (saved.quests !== undefined) {
		problems.push("quest data was not a table, dropped it");
	}

	if (typeIs(saved.achievements, "table")) {
		for (const [id, entry] of pairs(saved.achievements as Record<string, unknown>)) {
			const definition = typeIs(id, "string") ? catalog.getAchievement(id) : undefined;
			if (definition === undefined) {
				problems.push(`dropped unknown achievement ${tostring(id)}`);
				continue;
			}

			const [progress, tier] = typeIs(entry, "table") ? (entry as unknown[]) : [];
			const fixedProgress = isFiniteNumber(progress) ? math.max(progress, 0) : 0;
			// tiers already paid out stay paid out, even if thresholds moved since
			const fixedTier = isWholeAtLeast(tier, 0) ? math.min(tier, definition.tiers.size()) : 0;
			if (fixedProgress !== progress || fixedTier !== tier) {
				problems.push(`repaired achievement "${id}"`);
			}
			achievements.set(id, { progress: fixedProgress, tier: fixedTier });
		}
	} else if (saved.achievements !== undefined) {
		problems.push("achievement data was not a table, dropped it");
	}

	let streak: StreakState | undefined;
	if (saved.streak !== undefined) {
		const [lastDay, current, best] = typeIs(saved.streak, "table") ? (saved.streak as unknown[]) : [];
		if (isWholeAtLeast(lastDay, 0) && isWholeAtLeast(current, 1) && isWholeAtLeast(best, current)) {
			streak = { lastDay, current, best };
		} else {
			problems.push("dropped a malformed login streak");
		}
	}

	return { ok: true, state: { quests, achievements, streak }, problems };
}
