import { isWholeAtLeast } from "./numbers";
import { CompiledObjective, EventMatcher, Objective, compileObjective } from "./objectives";
import { pickRotation, rotationSeed } from "./rotation";
import { Period } from "./time";

export interface QuestDefinition<R = unknown> {
	readonly id: string;
	readonly objective: Objective;
	readonly requires?: readonly string[];
	readonly repeats?: Period;
	readonly reward?: R;
	readonly autoClaim?: boolean;
}

export interface AchievementTier<R = unknown> {
	readonly name: string;
	readonly threshold: number;
	readonly reward?: R;
}

export interface AchievementDefinition<R = unknown> extends EventMatcher {
	readonly id: string;
	// sum adds every matching value, max keeps the highest one seen (best wave, highest level)
	readonly mode?: "sum" | "max";
	readonly tiers: readonly AchievementTier<R>[];
	readonly hidden?: boolean;
}

export interface RotationOptions {
	// how many repeatable quests are offered each period, unset offers the whole pool
	readonly daily?: number;
	readonly weekly?: number;
	readonly seed?: number;
}

export interface CatalogOptions<R> {
	readonly quests?: readonly QuestDefinition<R>[];
	readonly achievements?: readonly AchievementDefinition<R>[];
	readonly rotation?: RotationOptions;
	readonly streakGraceDays?: number;
}

export interface CatalogQuest<R> {
	readonly definition: QuestDefinition<R>;
	readonly objective: CompiledObjective;
}

interface OfferCache {
	period: number;
	offers: readonly string[];
}

const NONE: readonly never[] = [];
const PERIOD_SALT: Record<Period, number> = { daily: 0, weekly: 7919 };

function checkRotationCount(count: number | undefined): void {
	if (count !== undefined && !isWholeAtLeast(count, 0)) {
		throw `rotation counts must be whole numbers of at least 0, got ${count}`;
	}
}

export class QuestCatalog<R = unknown> {
	public readonly streakGraceDays: number;

	private readonly quests = new Map<string, CatalogQuest<R>>();
	private readonly achievements = new Map<string, AchievementDefinition<R>>();
	private readonly questsByEvent = new Map<string, string[]>();
	private readonly achievementsByEvent = new Map<string, AchievementDefinition<R>[]>();
	private readonly reachQuests: string[] = [];
	private readonly pools: Record<Period, string[]> = { daily: [], weekly: [] };
	private readonly rotationCounts: Record<Period, number | undefined>;
	private readonly rotationSeed: number;
	private readonly offerCache: Record<Period, OfferCache | undefined> = { daily: undefined, weekly: undefined };

	public constructor(options: CatalogOptions<R>) {
		for (const definition of options.quests ?? NONE) {
			this.addQuest(definition);
		}
		for (const definition of options.achievements ?? NONE) {
			this.addAchievement(definition);
		}
		this.checkPrerequisites();

		const rotation = options.rotation ?? {};
		checkRotationCount(rotation.daily);
		checkRotationCount(rotation.weekly);
		const seed = rotation.seed ?? 0;
		if (!isWholeAtLeast(seed, 0)) {
			throw `rotation seed must be a whole number of at least 0, got ${seed}`;
		}
		const grace = options.streakGraceDays ?? 0;
		if (!isWholeAtLeast(grace, 0)) {
			throw `streakGraceDays must be a whole number of at least 0, got ${grace}`;
		}

		this.rotationCounts = { daily: rotation.daily, weekly: rotation.weekly };
		this.rotationSeed = seed;
		this.streakGraceDays = grace;
		// sorted so the rotation doesn't depend on the order quests happen to be registered in
		this.pools.daily.sort();
		this.pools.weekly.sort();
	}

	public getQuest(id: string): CatalogQuest<R> | undefined {
		return this.quests.get(id);
	}

	public getAchievement(id: string): AchievementDefinition<R> | undefined {
		return this.achievements.get(id);
	}

	public getQuestIds(): string[] {
		const ids: string[] = [];
		for (const [id] of this.quests) {
			ids.push(id);
		}
		ids.sort();
		return ids;
	}

	public getAchievementIds(): string[] {
		const ids: string[] = [];
		for (const [id] of this.achievements) {
			ids.push(id);
		}
		ids.sort();
		return ids;
	}

	public questsListeningTo(eventName: string): readonly string[] {
		return this.questsByEvent.get(eventName) ?? NONE;
	}

	public achievementsListeningTo(eventName: string): readonly AchievementDefinition<R>[] {
		return this.achievementsByEvent.get(eventName) ?? NONE;
	}

	public questsWithReach(): readonly string[] {
		return this.reachQuests;
	}

	public getOffers(period: Period, periodNumber: number): readonly string[] {
		const cached = this.offerCache[period];
		if (cached !== undefined && cached.period === periodNumber) {
			return cached.offers;
		}

		const pool = this.pools[period];
		const count = this.rotationCounts[period] ?? pool.size();
		const offers = pickRotation(pool, count, rotationSeed(periodNumber, this.rotationSeed + PERIOD_SALT[period]));
		this.offerCache[period] = { period: periodNumber, offers };
		return offers;
	}

	public isOffered(period: Period, periodNumber: number, id: string): boolean {
		return this.getOffers(period, periodNumber).includes(id);
	}

	private addQuest(definition: QuestDefinition<R>): void {
		const id = definition.id;
		if (this.quests.has(id)) {
			throw `quest "${id}" is defined twice`;
		}

		const objective = compileObjective(definition.objective, `quest "${id}"`);
		this.quests.set(id, { definition, objective });

		for (const eventName of objective.events) {
			let listening = this.questsByEvent.get(eventName);
			if (listening === undefined) {
				listening = [];
				this.questsByEvent.set(eventName, listening);
			}
			listening.push(id);
		}
		if (objective.hasReach) {
			this.reachQuests.push(id);
		}
		if (definition.repeats !== undefined) {
			this.pools[definition.repeats].push(id);
		}
	}

	private addAchievement(definition: AchievementDefinition<R>): void {
		const id = definition.id;
		if (this.achievements.has(id)) {
			throw `achievement "${id}" is defined twice`;
		} else if (definition.tiers.isEmpty()) {
			throw `achievement "${id}" needs at least one tier`;
		}

		let previous = 0;
		for (const tier of definition.tiers) {
			if (!(tier.threshold > previous && tier.threshold < math.huge)) {
				throw `achievement "${id}" tier "${tier.name}" needs a threshold above ${previous}, got ${tier.threshold}`;
			}
			previous = tier.threshold;
		}

		this.achievements.set(id, definition);
		let listening = this.achievementsByEvent.get(definition.event);
		if (listening === undefined) {
			listening = [];
			this.achievementsByEvent.set(definition.event, listening);
		}
		listening.push(definition);
	}

	private checkPrerequisites(): void {
		for (const [id, { definition }] of this.quests) {
			for (const required of definition.requires ?? NONE) {
				const other = this.quests.get(required);
				if (other === undefined) {
					throw `quest "${id}" requires unknown quest "${required}"`;
				} else if (other.definition.repeats !== undefined) {
					// repeatable quests reset, so "done" would flicker on and off every period
					throw `quest "${id}" can't require the repeatable quest "${required}"`;
				}
			}
		}

		const finished = new Set<string>();
		const path: string[] = [];
		const visit = (id: string) => {
			if (finished.has(id)) {
				return;
			}
			const start = path.indexOf(id);
			if (start !== -1) {
				const loop: string[] = [];
				for (let index = start; index < path.size(); index++) {
					loop.push(path[index]);
				}
				loop.push(id);
				throw `quest prerequisites loop: ${loop.join(" -> ")}`;
			}

			path.push(id);
			for (const required of this.quests.get(id)!.definition.requires ?? NONE) {
				visit(required);
			}
			path.pop();
			finished.add(id);
		};

		for (const id of this.getQuestIds()) {
			visit(id);
		}
	}
}
