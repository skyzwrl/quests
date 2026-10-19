/// <reference types="@rbxts/testez/globals" />

import { QuestCatalog } from "../catalog";
import { event, talk } from "../objectives";
import { QuestTracker } from "../tracker";
import { makeTracker } from "./fixtures";

export = () => {
	describe("accepting", () => {
		it("reports why a quest can't be accepted", () => {
			const { tracker } = makeTracker();
			expect(tracker.accept("nope")).to.equal("Unknown");
			expect(tracker.accept("smithing")).to.equal("Locked");
			expect(tracker.accept("tutorial")).to.equal("Accepted");
			expect(tracker.accept("tutorial")).to.equal("AlreadyActive");
		});

		it("unlocks dependents once the prerequisite is completed, claimed or not", () => {
			const { tracker } = makeTracker();
			tracker.accept("tutorial");
			expect(tracker.accept("smithing")).to.equal("Locked");

			tracker.track("talk", { npc: "Guide" });
			expect(tracker.getQuest("tutorial")!.status).to.equal("Completed");
			expect(tracker.accept("smithing")).to.equal("Accepted");
		});

		it("won't take a finished quest again", () => {
			const { tracker } = makeTracker();
			tracker.accept("tutorial");
			tracker.track("talk", { npc: "Guide" });
			expect(tracker.accept("tutorial")).to.equal("AlreadyDone");
			tracker.claim("tutorial");
			expect(tracker.accept("tutorial")).to.equal("AlreadyDone");
		});

		it("lets active and unclaimed quests be abandoned, but not claimed ones", () => {
			const { tracker } = makeTracker();
			tracker.accept("hunter");
			expect(tracker.abandon("hunter")).to.equal(true);
			expect(tracker.getQuest("hunter")).never.to.be.ok();
			expect(tracker.abandon("hunter")).to.equal(false);

			tracker.accept("tutorial");
			tracker.track("talk", { npc: "Guide" });
			tracker.claim("tutorial");
			expect(tracker.abandon("tutorial")).to.equal(false);
		});
	});

	describe("tracking", () => {
		it("moves a sequence one step at a time", () => {
			const { tracker } = makeTracker();
			tracker.accept("tutorial");
			tracker.track("talk", { npc: "Guide" });
			tracker.accept("smithing");

			tracker.track("collect", { item: "Iron", amount: 5 });
			expect(tracker.getQuest("smithing")!.progress.join(",")).to.equal("0,0,0");

			tracker.track("talk", { npc: "Blacksmith" });
			tracker.track("collect", { item: "Iron", amount: 3 });
			tracker.track("collect", { item: "Copper", amount: 3 });
			expect(tracker.getQuest("smithing")!.progress.join(",")).to.equal("1,3,0");

			tracker.track("collect", { item: "Iron", amount: 9 });
			expect(tracker.getQuest("smithing")!.progress.join(",")).to.equal("1,5,0");
			expect(tracker.getQuest("smithing")!.status).to.equal("Active");

			tracker.track("talk", { npc: "Blacksmith" });
			expect(tracker.getQuest("smithing")!.status).to.equal("Completed");
		});

		it("doesn't let one event finish the same npc step twice in a row", () => {
			const { tracker } = makeTracker();
			tracker.accept("tutorial");
			tracker.track("talk", { npc: "Guide" });
			tracker.accept("smithing");

			tracker.track("talk", { npc: "Blacksmith" });
			expect(tracker.getQuest("smithing")!.progress.join(",")).to.equal("1,0,0");
		});

		it("counts one event towards every matching part of an all", () => {
			const { tracker } = makeTracker();
			tracker.accept("hunter");

			tracker.track("defeat", { enemy: "Titan" });
			tracker.track("defeat", { enemy: "Wolf", amount: 4 });
			expect(tracker.getQuest("hunter")!.progress.join(",")).to.equal("1,5");

			tracker.track("defeat", { enemy: "Titan", amount: 20 });
			expect(tracker.getQuest("hunter")!.progress.join(",")).to.equal("3,10");
			expect(tracker.getQuest("hunter")!.status).to.equal("Completed");
		});

		it("ignores events for quests that aren't active", () => {
			const { tracker } = makeTracker();
			tracker.track("defeat", { enemy: "Titan", amount: 5 });
			tracker.accept("hunter");
			expect(tracker.getQuest("hunter")!.progress.join(",")).to.equal("0,0");
		});

		it("completes reach objectives inside their radius", () => {
			const { tracker, granted } = makeTracker();
			tracker.accept("summit");

			tracker.reportPosition(new Vector3(0, 470, 0));
			expect(tracker.getQuest("summit")!.status).to.equal("Active");

			tracker.reportPosition(new Vector3(10, 495, 5));
			expect(tracker.getQuest("summit")!.status).to.equal("Claimed");
			expect(granted.join(",")).to.equal("quest:summit:glider");
		});

		it("returns snapshots the caller can't use to change progress", () => {
			const { tracker } = makeTracker();
			tracker.accept("hunter");
			const snapshot = tracker.getQuest("hunter")!;
			(snapshot.progress as number[])[0] = 99;
			expect(tracker.getQuest("hunter")!.progress[0]).to.equal(0);
			expect(snapshot.targets.join(",")).to.equal("3,10");
		});

		it("lists quests in id order", () => {
			const { tracker } = makeTracker();
			tracker.accept("tutorial");
			tracker.accept("hunter");
			const ids = tracker.getQuests().map((snapshot) => snapshot.id);
			expect(ids.join(",")).to.equal("hunter,tutorial");
		});
	});

	describe("rewards", () => {
		it("grants a quest reward exactly once", () => {
			const { tracker, granted } = makeTracker();
			tracker.accept("tutorial");
			expect(tracker.claim("tutorial")).to.equal("NotComplete");

			tracker.track("talk", { npc: "Guide" });
			expect(tracker.claim("tutorial")).to.equal("Claimed");
			expect(tracker.claim("tutorial")).to.equal("AlreadyClaimed");
			expect(tracker.claim("hunter")).to.equal("NotActive");
			expect(granted.join(",")).to.equal("quest:tutorial:50 coins");
		});

		it("undoes the claim when the grant throws, so it can be retried", () => {
			let failing = true;
			const granted: string[] = [];
			const catalog = new QuestCatalog<string>({ quests: [{ id: "a", objective: talk("x"), reward: "gem" }] });
			const tracker = new QuestTracker(catalog, {
				clock: () => 0,
				grant: (reward) => {
					if (failing) {
						throw "inventory full";
					}
					granted.push(reward);
				},
			});

			tracker.accept("a");
			tracker.track("talk", { npc: "x" });
			expect(() => tracker.claim("a")).to.throw("inventory full");
			expect(tracker.getQuest("a")!.status).to.equal("Completed");

			failing = false;
			expect(tracker.claim("a")).to.equal("Claimed");
			expect(granted.join(",")).to.equal("gem");
		});

		it("treats a grant that claims again as a single claim", () => {
			const granted: string[] = [];
			let inner = "";
			const catalog = new QuestCatalog<string>({ quests: [{ id: "a", objective: talk("x"), reward: "gem" }] });
			const tracker: QuestTracker<string> = new QuestTracker(catalog, {
				clock: () => 0,
				grant: (reward) => {
					granted.push(reward);
					inner = tracker.claim("a");
				},
			});

			tracker.accept("a");
			tracker.track("talk", { npc: "x" });
			expect(tracker.claim("a")).to.equal("Claimed");
			expect(inner).to.equal("AlreadyClaimed");
			expect(granted.size()).to.equal(1);
		});

		it("claims auto-claim quests the moment they complete", () => {
			const { tracker, granted } = makeTracker();
			tracker.accept("summit");
			tracker.reportPosition(new Vector3(0, 500, 0));
			expect(tracker.claim("summit")).to.equal("AlreadyClaimed");
			expect(granted.size()).to.equal(1);
		});
	});

	describe("listeners", () => {
		it("reports updates and completions", () => {
			const { tracker } = makeTracker();
			const updates: string[] = [];
			const completions: string[] = [];
			tracker.onQuestUpdated((id) => updates.push(id));
			const disconnect = tracker.onQuestCompleted((id) => completions.push(id));

			tracker.accept("tutorial");
			tracker.track("talk", { npc: "Guide" });
			tracker.claim("tutorial");
			expect(updates.join(",")).to.equal("tutorial,tutorial,tutorial");
			expect(completions.join(",")).to.equal("tutorial");

			disconnect();
			tracker.accept("hunter");
			tracker.track("defeat", { enemy: "Titan", amount: 10 });
			expect(completions.join(",")).to.equal("tutorial");
		});

		it("doesn't report events that changed nothing", () => {
			const { tracker } = makeTracker();
			let updates = 0;
			tracker.accept("hunter");
			tracker.onQuestUpdated(() => updates++);

			tracker.track("defeat", { amount: -5 });
			tracker.track("chop");
			expect(updates).to.equal(0);
		});

		it("lets a listener accept the follow-up quest mid-update", () => {
			const catalog = new QuestCatalog({
				quests: [
					{ id: "first", objective: event("a") },
					{ id: "second", requires: ["first"], objective: event("a", 2) },
				],
			});
			const tracker = new QuestTracker(catalog, { clock: () => 0 });
			tracker.onQuestCompleted((id) => {
				if (id === "first") {
					tracker.accept("second");
				}
			});

			tracker.accept("first");
			tracker.track("a");
			expect(tracker.getQuest("second")!.progress[0]).to.equal(0);
			tracker.track("a");
			expect(tracker.getQuest("second")!.progress[0]).to.equal(1);
		});
	});
};
