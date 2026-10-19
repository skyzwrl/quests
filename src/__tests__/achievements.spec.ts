/// <reference types="@rbxts/testez/globals" />

import { QuestCatalog } from "../catalog";
import { QuestTracker } from "../tracker";
import { makeTracker } from "./fixtures";

export = () => {
	describe("tiered achievements", () => {
		it("unlocks tiers in order and pays each one out once", () => {
			const { tracker, granted } = makeTracker();
			const unlocked: string[] = [];
			tracker.onAchievementUnlocked((id, tier) => unlocked.push(`${id}${tier}`));

			tracker.track("defeat", { amount: 9 });
			expect(unlocked.size()).to.equal(0);
			tracker.track("defeat");
			tracker.track("defeat", { amount: 39 });
			tracker.track("defeat");

			expect(unlocked.join(",")).to.equal("slayer1,slayer2");
			expect(granted.join(",")).to.equal("achievement:slayer:slayer i,achievement:slayer:slayer ii");
		});

		it("unlocks several tiers from one big event", () => {
			const { tracker, granted } = makeTracker();
			tracker.track("defeat", { amount: 500 });

			const slayer = tracker.getAchievements().find((snapshot) => snapshot.id === "slayer")!;
			expect(slayer.unlocked).to.equal(3);
			expect(slayer.nextThreshold).never.to.be.ok();
			expect(granted.size()).to.equal(3);
		});

		it("keeps the best value in max mode", () => {
			const { tracker } = makeTracker();
			tracker.track("depth", { meters: 300 });
			tracker.track("depth", { meters: 120 });

			const diver = tracker.getAchievements().find((snapshot) => snapshot.id === "deep-diver")!;
			expect(diver.progress).to.equal(300);
			expect(diver.unlocked).to.equal(1);
			expect(diver.nextThreshold).to.equal(1000);
		});

		it("hides hidden achievements until their first tier", () => {
			const { tracker } = makeTracker();
			const visible = () =>
				tracker
					.getAchievements()
					.map((snapshot) => snapshot.id)
					.join(",");

			expect(visible()).to.equal("deep-diver,slayer");
			expect(tracker.getAchievements(true).size()).to.equal(3);

			tracker.track("pet", { animal: "Dog" });
			expect(visible()).to.equal("deep-diver,slayer");
			tracker.track("pet", { animal: "Cat" });
			expect(visible()).to.equal("deep-diver,secret-cat,slayer");
		});

		it("rolls a tier back when its grant throws", () => {
			let failing = true;
			const catalog = new QuestCatalog<string>({
				achievements: [{ id: "a", event: "x", tiers: [{ name: "one", threshold: 1, reward: "gem" }] }],
			});
			const tracker = new QuestTracker(catalog, {
				clock: () => 0,
				grant: () => {
					if (failing) {
						throw "nope";
					}
				},
			});

			expect(() => tracker.track("x")).to.throw("nope");
			expect(tracker.getAchievements()[0].unlocked).to.equal(0);

			failing = false;
			tracker.track("x");
			expect(tracker.getAchievements()[0].unlocked).to.equal(1);
		});

		it("reports progress changes, but not repeats that change nothing", () => {
			const { tracker } = makeTracker();
			let updates = 0;
			tracker.onAchievementUpdated(() => updates++);

			tracker.track("depth", { meters: 50 });
			tracker.track("depth", { meters: 50 });
			tracker.track("depth", { meters: 10 });
			tracker.track("depth", { amount: 400 });
			expect(updates).to.equal(1);
		});
	});
};
