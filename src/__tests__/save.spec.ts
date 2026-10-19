/// <reference types="@rbxts/testez/globals" />

import { dayNumber } from "../time";
import { LoadResult, QuestTracker } from "../tracker";
import { ManualClock, makeCatalog, makeTracker } from "./fixtures";

function describeQuests(tracker: QuestTracker<string>): string {
	return tracker
		.getQuests()
		.map((quest) => `${quest.id}=${quest.status}:${quest.progress.join("/")}`)
		.join(" ");
}

function describeAchievements(tracker: QuestTracker<string>): string {
	return tracker
		.getAchievements(true)
		.map((achievement) => `${achievement.id}=${achievement.progress}/${achievement.unlocked}`)
		.join(" ");
}

export = () => {
	const catalog = makeCatalog();

	const load = (data: unknown, clock = new ManualClock()) =>
		QuestTracker.fromSave(catalog, data, { clock: clock.now });

	const loaded = (result: LoadResult<string>) => {
		expect(result.ok).to.equal(true);
		return result as LoadResult<string> & { ok: true };
	};

	describe("round trip", () => {
		it("restores quests, achievements and the streak exactly", () => {
			const { tracker, clock } = makeTracker(catalog);
			tracker.recordLogin();
			clock.advanceDays(1);
			tracker.recordLogin();

			tracker.accept("tutorial");
			tracker.track("talk", { npc: "Guide" });
			tracker.claim("tutorial");
			tracker.accept("smithing");
			tracker.track("talk", { npc: "Blacksmith" });
			tracker.track("collect", { item: "Iron", amount: 3 });
			tracker.accept("hunter");
			tracker.track("defeat", { enemy: "Titan", amount: 12 });
			tracker.accept("daily-fish");
			tracker.track("fish", { amount: 2 });
			tracker.track("depth", { meters: 140 });

			const result = loaded(load(tracker.save(), clock));
			expect(result.problems.size()).to.equal(0);
			expect(describeQuests(result.tracker)).to.equal(describeQuests(tracker));
			expect(describeAchievements(result.tracker)).to.equal(describeAchievements(tracker));
			expect(result.tracker.getStreak()).to.equal(2);
		});

		it("doesn't pay anything out again after a reload", () => {
			const { tracker, clock, granted } = makeTracker(catalog);
			tracker.accept("tutorial");
			tracker.track("talk", { npc: "Guide" });
			tracker.claim("tutorial");
			tracker.track("defeat", { amount: 10 });
			expect(granted.size()).to.equal(2);

			const reloaded: string[] = [];
			const result = QuestTracker.fromSave(catalog, tracker.save(), {
				clock: clock.now,
				grant: (reward) => reloaded.push(reward),
			});
			const restored = loaded(result).tracker;
			expect(restored.claim("tutorial")).to.equal("AlreadyClaimed");
			restored.track("defeat", { amount: 5 });
			expect(reloaded.size()).to.equal(0);
		});

		it("saves claimed quests without their progress", () => {
			const { tracker } = makeTracker(catalog);
			tracker.accept("tutorial");
			tracker.track("talk", { npc: "Guide" });
			tracker.claim("tutorial");
			tracker.accept("hunter");

			const data = tracker.save();
			expect(data.quests["tutorial"].size()).to.equal(2);
			expect(data.quests["hunter"].size()).to.equal(4);
		});

		it("starts fresh when there's no save yet", () => {
			const result = loaded(load(undefined));
			expect(result.tracker.getQuests().size()).to.equal(0);
			expect(result.tracker.getStreak()).to.equal(0);
		});
	});

	describe("bad data", () => {
		it("refuses saves it can't read at all", () => {
			const notTable = load("corrupt");
			expect(notTable.ok).to.equal(false);
			expect(!notTable.ok && notTable.reason).to.equal("expected a table, got string");

			const future = load({ version: 2, quests: {}, achievements: {} });
			expect(!future.ok && future.reason).to.equal("unsupported save version 2");
		});

		it("drops unknown and malformed entries and says why", () => {
			const result = loaded(
				load({
					version: 1,
					quests: { ghost: [0, 0, 1], hunter: "bad", tutorial: [7, 0] },
					achievements: { nope: [1, 0] },
				}),
			);
			result.problems.sort();
			expect(result.problems.join(" | ")).to.equal(
				[
					`dropped quest "hunter", its entry was malformed`,
					`dropped quest "tutorial", its entry was malformed`,
					"dropped unknown achievement nope",
					"dropped unknown quest ghost",
				].join(" | "),
			);
			expect(result.tracker.getQuests().size()).to.equal(0);
		});

		it("resets progress when a quest's objectives changed shape", () => {
			const result = loaded(load({ version: 1, quests: { hunter: [0, 0, 1] }, achievements: {} }));
			expect(result.problems[0]).to.equal(`reset progress of "hunter", its objectives changed`);
			expect(result.tracker.getQuest("hunter")!.progress.join(",")).to.equal("0,0");
		});

		it("clamps progress into range", () => {
			const result = loaded(load({ version: 1, quests: { hunter: [0, 0, 99, -4] }, achievements: {} }));
			expect(result.problems[0]).to.equal(`clamped progress of "hunter" to its objectives`);
			expect(result.tracker.getQuest("hunter")!.progress.join(",")).to.equal("3,0");
			expect(result.tracker.getQuest("hunter")!.status).to.equal("Active");
		});

		it("fixes statuses that disagree with the progress", () => {
			const result = loaded(
				load({ version: 1, quests: { smithing: [1, 0, 1, 2, 0], hunter: [0, 0, 3, 10] }, achievements: {} }),
			);
			expect(result.problems.join(" | ")).to.equal(
				`"smithing" was saved as completed but its objectives aren't, set it back to active`,
			);
			expect(result.tracker.getQuest("smithing")!.status).to.equal("Active");
			expect(result.tracker.getQuest("hunter")!.status).to.equal("Completed");
		});

		it("quietly drops dailies taken on an earlier day", () => {
			const clock = new ManualClock();
			const yesterday = dayNumber(clock.time) - 1;
			const result = loaded(
				load({ version: 1, quests: { "daily-fish": [0, yesterday, 2] }, achievements: {} }, clock),
			);
			expect(result.problems.size()).to.equal(0);
			// nothing left for refresh to expire, so no update fires for a quest the player never saw
			expect(result.tracker.refresh().size()).to.equal(0);
			expect(result.tracker.getQuest("daily-fish")).never.to.be.ok();
		});

		it("keeps a daily saved earlier the same day", () => {
			const clock = new ManualClock();
			const result = loaded(
				load({ version: 1, quests: { "daily-fish": [0, dayNumber(clock.time), 2] }, achievements: {} }, clock),
			);
			expect(result.tracker.getQuest("daily-fish")!.progress[0]).to.equal(2);
		});

		it("repairs achievements and drops a malformed streak", () => {
			const result = loaded(
				load({ version: 1, quests: {}, achievements: { slayer: [-5, 9] }, streak: [100, 0, 0] }),
			);
			result.problems.sort();
			expect(result.problems.join(" | ")).to.equal(
				`dropped a malformed login streak | repaired achievement "slayer"`,
			);
			expect(describeAchievements(result.tracker)).to.equal("deep-diver=0/0 secret-cat=0/0 slayer=0/3");
			expect(result.tracker.getStreak()).to.equal(0);
		});
	});
};
