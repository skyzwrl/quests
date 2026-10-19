import { CatalogOptions, QuestCatalog } from "../catalog";
import { all, event, reach, sequence, talk } from "../objectives";
import { DAY } from "../time";
import { QuestTracker, RewardSource } from "../tracker";

// 2024-01-01 00:00:00 utc, a monday
export const MONDAY = 1704067200;

export class ManualClock {
	public constructor(public time = MONDAY + 12 * 3600) {}

	public readonly now = () => this.time;

	public advance(seconds: number): void {
		this.time += seconds;
	}

	public advanceDays(days: number): void {
		this.time += days * DAY;
	}
}

export const QUESTS: CatalogOptions<string>["quests"] = [
	{ id: "tutorial", objective: talk("Guide"), reward: "50 coins" },
	{
		id: "smithing",
		requires: ["tutorial"],
		objective: sequence(talk("Blacksmith"), event("collect", 5, { item: "Iron" }), talk("Blacksmith")),
		reward: "iron sword",
	},
	{
		id: "hunter",
		objective: all(event("defeat", 3, { enemy: "Titan" }), event("defeat", 10)),
		reward: "hunter badge",
	},
	{ id: "summit", objective: reach(new Vector3(0, 500, 0), 20), reward: "glider", autoClaim: true },
	{ id: "daily-fish", repeats: "daily", objective: event("fish", 5), reward: "bait" },
	{ id: "daily-ore", repeats: "daily", objective: event("mine", 20), reward: "pickaxe xp" },
	{ id: "daily-wood", repeats: "daily", objective: event("chop", 15), reward: "planks" },
	{ id: "weekly-boss", repeats: "weekly", objective: event("defeat", 1, { enemy: "Colossal" }), reward: "crate" },
];

export const ACHIEVEMENTS: CatalogOptions<string>["achievements"] = [
	{
		id: "slayer",
		event: "defeat",
		tiers: [
			{ name: "bronze", threshold: 10, reward: "slayer i" },
			{ name: "silver", threshold: 50, reward: "slayer ii" },
			{ name: "gold", threshold: 200, reward: "slayer iii" },
		],
	},
	{
		id: "deep-diver",
		event: "depth",
		mode: "max",
		valueKey: "meters",
		tiers: [
			{ name: "bronze", threshold: 100 },
			{ name: "gold", threshold: 1000 },
		],
	},
	{
		id: "secret-cat",
		event: "pet",
		filter: { animal: "Cat" },
		hidden: true,
		tiers: [{ name: "found it", threshold: 1, reward: "cat ears" }],
	},
];

export function makeCatalog(overrides: Partial<CatalogOptions<string>> = {}): QuestCatalog<string> {
	return new QuestCatalog<string>({ quests: QUESTS, achievements: ACHIEVEMENTS, ...overrides });
}

export interface Harness {
	readonly clock: ManualClock;
	readonly catalog: QuestCatalog<string>;
	readonly tracker: QuestTracker<string>;
	readonly granted: string[];
}

export function makeTracker(catalog = makeCatalog(), clock = new ManualClock()): Harness {
	const granted: string[] = [];
	const tracker = new QuestTracker(catalog, {
		clock: clock.now,
		grant: (reward: string, source: RewardSource) => {
			granted.push(`${source.kind}:${source.id}:${reward}`);
		},
	});
	return { clock, catalog, tracker, granted };
}
