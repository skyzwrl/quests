/// <reference types="@rbxts/testez/globals" />

import { QuestCatalog } from "../catalog";
import { event, talk } from "../objectives";
import { makeCatalog } from "./fixtures";

export = () => {
	describe("validation", () => {
		it("rejects duplicate quest and achievement ids", () => {
			expect(
				() =>
					new QuestCatalog({
						quests: [
							{ id: "a", objective: talk("x") },
							{ id: "a", objective: talk("y") },
						],
					}),
			).to.throw(`quest "a" is defined twice`);

			const tiers = [{ name: "one", threshold: 1 }];
			expect(
				() =>
					new QuestCatalog({
						achievements: [
							{ id: "b", event: "x", tiers },
							{ id: "b", event: "y", tiers },
						],
					}),
			).to.throw(`achievement "b" is defined twice`);
		});

		it("names the quest when an objective is invalid", () => {
			expect(() => new QuestCatalog({ quests: [{ id: "broken", objective: event("x", -1) }] })).to.throw(
				`quest "broken"`,
			);
		});

		it("rejects prerequisites that don't exist or that repeat", () => {
			expect(
				() => new QuestCatalog({ quests: [{ id: "a", requires: ["ghost"], objective: talk("x") }] }),
			).to.throw(`requires unknown quest "ghost"`);

			expect(
				() =>
					new QuestCatalog({
						quests: [
							{ id: "daily", repeats: "daily", objective: talk("x") },
							{ id: "a", requires: ["daily"], objective: talk("y") },
						],
					}),
			).to.throw(`can't require the repeatable quest "daily"`);
		});

		it("reports prerequisite loops with the path", () => {
			expect(
				() =>
					new QuestCatalog({
						quests: [
							{ id: "a", requires: ["c"], objective: talk("x") },
							{ id: "b", requires: ["a"], objective: talk("x") },
							{ id: "c", requires: ["b"], objective: talk("x") },
						],
					}),
			).to.throw("quest prerequisites loop: a -> c -> b -> a");
		});

		it("requires achievement tiers to climb", () => {
			expect(
				() =>
					new QuestCatalog({
						achievements: [
							{
								id: "x",
								event: "y",
								tiers: [
									{ name: "first", threshold: 10 },
									{ name: "second", threshold: 10 },
								],
							},
						],
					}),
			).to.throw(`tier "second" needs a threshold above 10`);
			expect(() => new QuestCatalog({ achievements: [{ id: "x", event: "y", tiers: [] }] })).to.throw(
				"needs at least one tier",
			);
		});

		it("rejects bad rotation and grace settings", () => {
			expect(() => new QuestCatalog({ rotation: { daily: 1.5 } })).to.throw("rotation counts");
			expect(() => new QuestCatalog({ rotation: { seed: -1 } })).to.throw("rotation seed");
			expect(() => new QuestCatalog({ streakGraceDays: -2 })).to.throw("streakGraceDays");
		});
	});

	describe("lookups", () => {
		it("indexes quests and achievements by the events they listen to", () => {
			const catalog = makeCatalog();
			expect(catalog.questsListeningTo("talk").join(",")).to.equal("tutorial,smithing");
			expect(catalog.questsListeningTo("defeat").join(",")).to.equal("hunter,weekly-boss");
			expect(catalog.questsListeningTo("nothing").size()).to.equal(0);
			expect(catalog.achievementsListeningTo("defeat")[0].id).to.equal("slayer");
			expect(catalog.questsWithReach().join(",")).to.equal("summit");
		});

		it("lists ids sorted", () => {
			const catalog = makeCatalog();
			expect(catalog.getAchievementIds().join(",")).to.equal("deep-diver,secret-cat,slayer");
			expect(catalog.getQuestIds()[0]).to.equal("daily-fish");
		});
	});
};
