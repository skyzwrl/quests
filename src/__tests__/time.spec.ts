/// <reference types="@rbxts/testez/globals" />

import { DAY, dayNumber, nextReset, periodNumber, weekNumber } from "../time";
import { MONDAY } from "./fixtures";

export = () => {
	describe("utc periods", () => {
		it("rolls the day over exactly at midnight utc", () => {
			expect(dayNumber(MONDAY - 1)).to.equal(dayNumber(MONDAY) - 1);
			expect(dayNumber(MONDAY)).to.equal(19723);
			expect(dayNumber(MONDAY + DAY - 1)).to.equal(19723);
			expect(dayNumber(MONDAY + DAY)).to.equal(19724);
		});

		it("starts weeks on monday, not on the unix epoch's thursday", () => {
			const sunday = MONDAY - 1;
			expect(weekNumber(MONDAY)).to.equal(weekNumber(sunday) + 1);
			for (let day = 0; day < 7; day++) {
				expect(weekNumber(MONDAY + day * DAY + 3600)).to.equal(weekNumber(MONDAY));
			}
			expect(weekNumber(MONDAY + 7 * DAY)).to.equal(weekNumber(MONDAY) + 1);
		});

		it("puts 1970-01-01, a thursday, in week 0 and the next monday in week 1", () => {
			expect(weekNumber(0)).to.equal(0);
			expect(weekNumber(3 * DAY + DAY - 1)).to.equal(0);
			expect(weekNumber(4 * DAY)).to.equal(1);
		});

		it("reports the next reset for each period", () => {
			const wednesdayNoon = MONDAY + 2 * DAY + 12 * 3600;
			expect(nextReset("daily", wednesdayNoon)).to.equal(MONDAY + 3 * DAY);
			expect(nextReset("weekly", wednesdayNoon)).to.equal(MONDAY + 7 * DAY);
			expect(nextReset("weekly", MONDAY)).to.equal(MONDAY + 7 * DAY);
			expect(nextReset("daily", MONDAY + DAY - 1)).to.equal(MONDAY + DAY);
		});

		it("maps periods to day and week numbers", () => {
			expect(periodNumber("daily", MONDAY + 5)).to.equal(dayNumber(MONDAY));
			expect(periodNumber("weekly", MONDAY + 5)).to.equal(weekNumber(MONDAY));
		});
	});
};
