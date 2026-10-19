/// <reference types="@rbxts/testez/globals" />

import { QuestCatalog, QuestDefinition } from "../catalog";
import { event } from "../objectives";
import { DAY, dayNumber } from "../time";
import { QuestTracker } from "../tracker";
import { MONDAY, ManualClock, makeTracker } from "./fixtures";

function dailyPool(count: number): QuestDefinition[] {
	const quests: QuestDefinition[] = [];
	for (let index = 1; index <= count; index++) {
		quests.push({ id: `daily-${index}`, repeats: "daily", objective: event(`task-${index}`) });
	}
	return quests;
}

export = () => {
	describe("daily reset", () => {
		it("keeps a daily until 23:59:59 utc and drops it at midnight", () => {
			const clock = new ManualClock(MONDAY + DAY - 10);
			const { tracker } = makeTracker(undefined, clock);
			expect(tracker.accept("daily-fish")).to.equal("Accepted");
			tracker.track("fish", { amount: 2 });

			clock.time = MONDAY + DAY - 1;
			expect(tracker.getQuest("daily-fish")!.progress[0]).to.equal(2);

			clock.time = MONDAY + DAY;
			expect(tracker.getQuest("daily-fish")).never.to.be.ok();
		});

		it("lets an unclaimed completed daily expire", () => {
			const { tracker, clock, granted } = makeTracker();
			tracker.accept("daily-fish");
			tracker.track("fish", { amount: 5 });
			expect(tracker.getQuest("daily-fish")!.status).to.equal("Completed");

			clock.advanceDays(1);
			expect(tracker.claim("daily-fish")).to.equal("NotActive");
			expect(granted.size()).to.equal(0);
		});

		it("offers a claimed daily again the next day", () => {
			const { tracker, clock, granted } = makeTracker();
			tracker.accept("daily-fish");
			tracker.track("fish", { amount: 5 });
			tracker.claim("daily-fish");
			expect(tracker.accept("daily-fish")).to.equal("AlreadyDone");

			clock.advanceDays(1);
			expect(tracker.accept("daily-fish")).to.equal("Accepted");
			tracker.track("fish", { amount: 5 });
			tracker.claim("daily-fish");
			expect(granted.join(",")).to.equal("quest:daily-fish:bait,quest:daily-fish:bait");
		});

		it("returns and announces what refresh dropped", () => {
			const { tracker, clock } = makeTracker();
			tracker.accept("daily-fish");
			tracker.accept("daily-ore");
			tracker.accept("hunter");
			const updates: string[] = [];
			tracker.onQuestUpdated((id) => updates.push(id));

			expect(tracker.refresh().size()).to.equal(0);
			clock.advanceDays(1);
			const dropped = tracker.refresh();
			dropped.sort();
			updates.sort();
			expect(dropped.join(",")).to.equal("daily-fish,daily-ore");
			expect(updates.join(",")).to.equal("daily-fish,daily-ore");
			expect(tracker.getQuest("hunter")).to.be.ok();
		});

		it("counts down to the next reset", () => {
			const { tracker } = makeTracker(undefined, new ManualClock(MONDAY + DAY - 90));
			expect(tracker.timeUntilReset("daily")).to.equal(90);
			expect(tracker.timeUntilReset("weekly")).to.equal(6 * DAY + 90);
		});
	});

	describe("weekly reset", () => {
		it("survives sunday night and resets monday 00:00 utc", () => {
			const clock = new ManualClock(MONDAY + 2 * DAY);
			const { tracker } = makeTracker(undefined, clock);
			tracker.accept("weekly-boss");

			clock.time = MONDAY + 7 * DAY - 1;
			expect(tracker.getQuest("weekly-boss")).to.be.ok();

			clock.time = MONDAY + 7 * DAY;
			expect(tracker.getQuest("weekly-boss")).never.to.be.ok();
			expect(tracker.accept("weekly-boss")).to.equal("Accepted");
		});
	});

	describe("rotation", () => {
		it("offers the same dailies on every server for the same day", () => {
			const pool = dailyPool(12);
			const reversed: QuestDefinition[] = [];
			for (let index = pool.size() - 1; index >= 0; index--) {
				reversed.push(pool[index]);
			}
			const first = new QuestCatalog({ quests: pool, rotation: { daily: 3, seed: 77 } });
			const second = new QuestCatalog({ quests: reversed, rotation: { daily: 3, seed: 77 } });

			for (let day = 0; day < 30; day++) {
				const today = dayNumber(MONDAY) + day;
				expect(first.getOffers("daily", today).join(",")).to.equal(second.getOffers("daily", today).join(","));
			}
		});

		it("offers the configured number of distinct quests from the pool", () => {
			const catalog = new QuestCatalog({ quests: dailyPool(12), rotation: { daily: 4 } });
			for (let day = 0; day < 30; day++) {
				const offers = catalog.getOffers("daily", dayNumber(MONDAY) + day);
				expect(offers.size()).to.equal(4);
				expect(new Set(offers).size()).to.equal(4);
				for (const id of offers) {
					expect(catalog.getQuest(id)!.definition.repeats).to.equal("daily");
				}
			}
		});

		it("changes the offers from day to day", () => {
			const catalog = new QuestCatalog({ quests: dailyPool(12), rotation: { daily: 3 } });
			const seen = new Set<string>();
			for (let day = 0; day < 14; day++) {
				seen.add(catalog.getOffers("daily", dayNumber(MONDAY) + day).join(","));
			}
			expect(seen.size() > 10).to.equal(true);
		});

		it("refuses dailies that aren't on offer today", () => {
			const clock = new ManualClock();
			const catalog = new QuestCatalog({ quests: dailyPool(12), rotation: { daily: 2 } });
			const tracker = new QuestTracker(catalog, { clock: clock.now });

			const offers = tracker.getOffers("daily");
			for (const id of catalog.getQuestIds()) {
				expect(tracker.accept(id)).to.equal(offers.includes(id) ? "Accepted" : "NotOffered");
			}
		});

		it("offers the whole pool when no count is set", () => {
			const { tracker } = makeTracker();
			expect(tracker.getOffers("daily").join(",")).to.equal("daily-fish,daily-ore,daily-wood");
			expect(tracker.getOffers("weekly").join(",")).to.equal("weekly-boss");
		});

		it("rotates weekly quests out of their own pool", () => {
			const pool: QuestDefinition[] = [...dailyPool(8)];
			for (let index = 1; index <= 8; index++) {
				pool.push({ id: `weekly-${index}`, repeats: "weekly", objective: event(`w-${index}`) });
			}
			const catalog = new QuestCatalog({ quests: pool, rotation: { daily: 2, weekly: 2 } });
			const offers = catalog.getOffers("weekly", 2818);
			expect(offers.size()).to.equal(2);
			for (const id of offers) {
				expect(id.sub(1, 7)).to.equal("weekly-");
			}
		});
	});
};
