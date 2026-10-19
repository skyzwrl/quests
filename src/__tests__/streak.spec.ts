/// <reference types="@rbxts/testez/globals" />

import { advanceStreak } from "../streak";
import { DAY } from "../time";
import { MONDAY, makeCatalog, makeTracker } from "./fixtures";

export = () => {
	describe("login streaks", () => {
		it("starts at 1 and ignores a second login the same day", () => {
			const { tracker, clock } = makeTracker();
			const first = tracker.recordLogin();
			expect(first.status).to.equal("Started");
			expect(first.streak).to.equal(1);

			clock.advance(3600);
			const again = tracker.recordLogin();
			expect(again.status).to.equal("SameDay");
			expect(again.streak).to.equal(1);
		});

		it("grows on consecutive utc days even across midnight", () => {
			const { tracker, clock } = makeTracker();
			clock.time = MONDAY + DAY - 60;
			tracker.recordLogin();

			clock.advance(120);
			const tomorrow = tracker.recordLogin();
			expect(tomorrow.status).to.equal("Continued");
			expect(tomorrow.streak).to.equal(2);
		});

		it("breaks after a missed day and keeps the best", () => {
			const { tracker, clock } = makeTracker();
			for (let day = 0; day < 4; day++) {
				tracker.recordLogin();
				clock.advanceDays(1);
			}
			clock.advanceDays(1);

			const result = tracker.recordLogin();
			expect(result.status).to.equal("Broken");
			expect(result.streak).to.equal(1);
			expect(result.best).to.equal(4);
			expect(result.missedDays).to.equal(1);
		});

		it("saves the streak when the gap fits inside the grace days", () => {
			const { tracker, clock } = makeTracker(makeCatalog({ streakGraceDays: 1 }));
			tracker.recordLogin();
			clock.advanceDays(2);

			const saved = tracker.recordLogin();
			expect(saved.status).to.equal("Saved");
			expect(saved.streak).to.equal(2);
			expect(saved.missedDays).to.equal(1);

			clock.advanceDays(3);
			expect(tracker.recordLogin().status).to.equal("Broken");
			expect(tracker.getStreak()).to.equal(1);
		});

		it("leaves the streak alone when the clock goes backwards", () => {
			const start = advanceStreak(undefined, 100, 0);
			const later = advanceStreak(start.state, 101, 0);
			const backwards = advanceStreak(later.state, 99, 0);
			expect(backwards.status).to.equal("SameDay");
			expect(backwards.state.current).to.equal(2);
			expect(backwards.state.lastDay).to.equal(101);
		});
	});
};
