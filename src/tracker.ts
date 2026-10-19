import { AchievementDefinition, CatalogQuest, QuestCatalog } from "./catalog";
import { Listeners } from "./listeners";
import { EventPayload, Leaf, collectActiveLeaves, eventValue, isComplete } from "./objectives";
import { SaveData, readSave, writeSave } from "./save";
import { AchievementState, QuestState, QuestStatus } from "./state";
import { StreakState, StreakStatus, advanceStreak } from "./streak";
import { Period, dayNumber, nextReset, periodNumber, weekNumber } from "./time";

export type AcceptResult = "Accepted" | "Unknown" | "AlreadyActive" | "AlreadyDone" | "Locked" | "NotOffered";

export type ClaimResult = "Claimed" | "NotActive" | "NotComplete" | "AlreadyClaimed";

export type RewardSource =
	| { readonly kind: "quest"; readonly id: string }
	| { readonly kind: "achievement"; readonly id: string; readonly tier: number };

export interface TrackerOptions<R> {
	// unix seconds, read on the server; defaults to os.time
	readonly clock?: () => number;
	// throwing from here undoes the claim or unlock so it can be retried
	readonly grant?: (reward: R, source: RewardSource) => void;
}

export interface QuestSnapshot {
	readonly id: string;
	readonly status: QuestStatus;
	readonly progress: readonly number[];
	readonly targets: readonly number[];
}

export interface AchievementSnapshot {
	readonly id: string;
	readonly progress: number;
	readonly unlocked: number;
	readonly nextThreshold?: number;
	readonly hidden: boolean;
}

export interface LoginResult {
	readonly status: StreakStatus;
	readonly streak: number;
	readonly best: number;
	readonly missedDays: number;
}

export type LoadResult<R> =
	| { readonly ok: true; readonly tracker: QuestTracker<R>; readonly problems: string[] }
	| { readonly ok: false; readonly reason: string };

const EMPTY_PAYLOAD: EventPayload = {};

export class QuestTracker<R = unknown> {
	private readonly clock: () => number;
	private readonly grant?: (reward: R, source: RewardSource) => void;
	private readonly quests = new Map<string, QuestState>();
	private readonly achievements = new Map<string, AchievementState>();
	private readonly questUpdated = new Listeners<[id: string]>();
	private readonly questCompleted = new Listeners<[id: string]>();
	private readonly achievementUpdated = new Listeners<[id: string]>();
	private readonly achievementUnlocked = new Listeners<[id: string, tier: number]>();
	private streak?: StreakState;
	private day = -1;
	private week = -1;

	public constructor(
		private readonly catalog: QuestCatalog<R>,
		options: TrackerOptions<R> = {},
	) {
		this.clock = options.clock ?? (() => os.time());
		this.grant = options.grant;
	}

	public static fromSave<R>(catalog: QuestCatalog<R>, data: unknown, options: TrackerOptions<R> = {}): LoadResult<R> {
		const tracker = new QuestTracker(catalog, options);
		const result = readSave(catalog, data, tracker.clock());
		if (!result.ok) {
			return result;
		}

		for (const [id, quest] of result.state.quests) {
			tracker.quests.set(id, quest);
		}
		for (const [id, achievement] of result.state.achievements) {
			tracker.achievements.set(id, achievement);
		}
		tracker.streak = result.state.streak;
		return { ok: true, tracker, problems: result.problems };
	}

	public save(): SaveData {
		this.refresh();
		return writeSave({ quests: this.quests, achievements: this.achievements, streak: this.streak });
	}

	public accept(id: string): AcceptResult {
		this.refresh();
		const quest = this.catalog.getQuest(id);
		if (quest === undefined) {
			return "Unknown";
		}

		const existing = this.quests.get(id);
		if (existing !== undefined) {
			return existing.status === "Active" ? "AlreadyActive" : "AlreadyDone";
		}
		for (const required of quest.definition.requires ?? []) {
			const prerequisite = this.quests.get(required);
			if (prerequisite === undefined || prerequisite.status === "Active") {
				return "Locked";
			}
		}

		let period = 0;
		const repeats = quest.definition.repeats;
		if (repeats !== undefined) {
			period = this.currentPeriod(repeats);
			if (!this.catalog.isOffered(repeats, period, id)) {
				return "NotOffered";
			}
		}

		this.quests.set(id, { status: "Active", period, progress: table.create(quest.objective.leaves.size(), 0) });
		this.questUpdated.fire(id);
		return "Accepted";
	}

	public abandon(id: string): boolean {
		const state = this.quests.get(id);
		if (state === undefined || state.status === "Claimed") {
			return false;
		}
		this.quests.delete(id);
		this.questUpdated.fire(id);
		return true;
	}

	public claim(id: string): ClaimResult {
		this.refresh();
		const state = this.quests.get(id);
		if (state === undefined) {
			return "NotActive";
		} else if (state.status === "Active") {
			return "NotComplete";
		} else if (state.status === "Claimed") {
			return "AlreadyClaimed";
		}

		// marked first so a grant that re-enters claim() sees it as taken
		state.status = "Claimed";
		const reward = this.catalog.getQuest(id)!.definition.reward;
		if (reward !== undefined && this.grant !== undefined) {
			try {
				this.grant(reward, { kind: "quest", id });
			} catch (problem) {
				state.status = "Completed";
				throw problem;
			}
		}
		this.questUpdated.fire(id);
		return "Claimed";
	}

	public track(eventName: string, payload: EventPayload = EMPTY_PAYLOAD): void {
		this.refresh();

		const live: Leaf[] = [];
		for (const id of this.activeAmong(this.catalog.questsListeningTo(eventName))) {
			// a listener earlier in this loop may have abandoned or claimed it
			const state = this.quests.get(id);
			if (state === undefined || state.status !== "Active") {
				continue;
			}

			const quest = this.catalog.getQuest(id)!;
			live.clear();
			collectActiveLeaves(quest.objective.root, state.progress, live);

			let changed = false;
			for (const leaf of live) {
				const objective = leaf.objective;
				if (objective.kind === "event" && objective.event === eventName) {
					const value = eventValue(objective, payload);
					if (value > 0) {
						state.progress[leaf.index] = math.min(state.progress[leaf.index] + value, leaf.target);
						changed = true;
					}
				}
			}
			if (changed) {
				this.progressed(id, quest, state);
			}
		}

		for (const definition of this.catalog.achievementsListeningTo(eventName)) {
			this.advanceAchievement(definition, eventValue(definition, payload));
		}
	}

	public reportPosition(position: Vector3): void {
		this.refresh();

		const live: Leaf[] = [];
		for (const id of this.activeAmong(this.catalog.questsWithReach())) {
			const state = this.quests.get(id);
			if (state === undefined || state.status !== "Active") {
				continue;
			}

			const quest = this.catalog.getQuest(id)!;
			live.clear();
			collectActiveLeaves(quest.objective.root, state.progress, live);

			let changed = false;
			for (const leaf of live) {
				const objective = leaf.objective;
				if (objective.kind === "reach" && position.sub(objective.position).Magnitude <= objective.radius) {
					state.progress[leaf.index] = 1;
					changed = true;
				}
			}
			if (changed) {
				this.progressed(id, quest, state);
			}
		}
	}

	public recordLogin(): LoginResult {
		const update = advanceStreak(this.streak, dayNumber(this.clock()), this.catalog.streakGraceDays);
		this.streak = update.state;
		return {
			status: update.status,
			streak: update.state.current,
			best: update.state.best,
			missedDays: update.missedDays,
		};
	}

	public getStreak(): number {
		return this.streak?.current ?? 0;
	}

	public getOffers(period: Period): readonly string[] {
		return this.catalog.getOffers(period, this.currentPeriod(period));
	}

	public timeUntilReset(period: Period): number {
		const now = this.clock();
		return nextReset(period, now) - now;
	}

	public getQuest(id: string): QuestSnapshot | undefined {
		this.refresh();
		const state = this.quests.get(id);
		if (state === undefined) {
			return undefined;
		}
		const leaves = this.catalog.getQuest(id)!.objective.leaves;
		return {
			id,
			status: state.status,
			progress: table.clone(state.progress),
			targets: leaves.map((leaf) => leaf.target),
		};
	}

	public getQuests(): QuestSnapshot[] {
		this.refresh();
		const snapshots: QuestSnapshot[] = [];
		for (const id of this.catalog.getQuestIds()) {
			const snapshot = this.getQuest(id);
			if (snapshot !== undefined) {
				snapshots.push(snapshot);
			}
		}
		return snapshots;
	}

	public getAchievements(includeHidden = false): AchievementSnapshot[] {
		const snapshots: AchievementSnapshot[] = [];
		for (const id of this.catalog.getAchievementIds()) {
			const definition = this.catalog.getAchievement(id)!;
			const state = this.achievements.get(id);
			const unlocked = state?.tier ?? 0;
			const hidden = definition.hidden === true;
			// hidden ones show up once their first tier is earned
			if (hidden && unlocked === 0 && !includeHidden) {
				continue;
			}
			snapshots.push({
				id,
				progress: state?.progress ?? 0,
				unlocked,
				nextThreshold: definition.tiers[unlocked]?.threshold,
				hidden,
			});
		}
		return snapshots;
	}

	// drops daily and weekly quests taken in an earlier period. runs before everything that reads or
	// changes quests, and returns the ids it dropped for anyone who wants to tell the player
	public refresh(): string[] {
		const now = this.clock();
		const day = dayNumber(now);
		const week = weekNumber(now);
		if (day === this.day && week === this.week) {
			return [];
		}
		this.day = day;
		this.week = week;

		const expired: string[] = [];
		for (const [id, state] of this.quests) {
			const repeats = this.catalog.getQuest(id)!.definition.repeats;
			if (repeats !== undefined && state.period !== periodNumber(repeats, now)) {
				expired.push(id);
			}
		}
		for (const id of expired) {
			this.quests.delete(id);
		}
		for (const id of expired) {
			this.questUpdated.fire(id);
		}
		return expired;
	}

	public onQuestUpdated(listener: (id: string) => void): () => void {
		return this.questUpdated.add(listener);
	}

	public onQuestCompleted(listener: (id: string) => void): () => void {
		return this.questCompleted.add(listener);
	}

	public onAchievementUpdated(listener: (id: string) => void): () => void {
		return this.achievementUpdated.add(listener);
	}

	public onAchievementUnlocked(listener: (id: string, tier: number) => void): () => void {
		return this.achievementUnlocked.add(listener);
	}

	// taken before anything is applied, so a quest a listener accepts mid-update doesn't count the event that
	// triggered it
	private activeAmong(candidates: readonly string[]): string[] {
		const active: string[] = [];
		for (const id of candidates) {
			if (this.quests.get(id)?.status === "Active") {
				active.push(id);
			}
		}
		return active;
	}

	private currentPeriod(period: Period): number {
		return periodNumber(period, this.clock());
	}

	private progressed(id: string, quest: CatalogQuest<R>, state: QuestState): void {
		const finished = isComplete(quest.objective.root, state.progress);
		if (finished) {
			state.status = "Completed";
		}
		this.questUpdated.fire(id);

		if (finished) {
			this.questCompleted.fire(id);
			if (quest.definition.autoClaim === true && state.status === "Completed") {
				this.claim(id);
			}
		}
	}

	private advanceAchievement(definition: AchievementDefinition<R>, value: number): void {
		if (value <= 0) {
			return;
		}

		let state = this.achievements.get(definition.id);
		if (state === undefined) {
			state = { progress: 0, tier: 0 };
			this.achievements.set(definition.id, state);
		}

		const before = state.progress;
		state.progress = definition.mode === "max" ? math.max(before, value) : before + value;
		if (state.progress === before) {
			return;
		}
		this.achievementUpdated.fire(definition.id);

		const tiers = definition.tiers;
		while (state.tier < tiers.size() && state.progress >= tiers[state.tier].threshold) {
			const tier = tiers[state.tier];
			state.tier += 1;
			if (tier.reward !== undefined && this.grant !== undefined) {
				try {
					this.grant(tier.reward, { kind: "achievement", id: definition.id, tier: state.tier });
				} catch (problem) {
					state.tier -= 1;
					throw problem;
				}
			}
			this.achievementUnlocked.fire(definition.id, state.tier);
		}
	}
}
