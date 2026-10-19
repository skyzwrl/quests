/// <reference types="@rbxts/testez/globals" />

import {
	EventObjective,
	Leaf,
	all,
	collectActiveLeaves,
	compileObjective,
	event,
	eventValue,
	isComplete,
	reach,
	sequence,
	talk,
} from "../objectives";

function activeIndexes(objective: ReturnType<typeof compileObjective>, progress: number[]): string {
	const live: Leaf[] = [];
	collectActiveLeaves(objective.root, progress, live);
	return live.map((leaf) => tostring(leaf.index)).join(",");
}

export = () => {
	describe("compiling", () => {
		it("numbers leaves depth first and records what they listen to", () => {
			const compiled = compileObjective(
				sequence(talk("Guide"), all(event("collect", 3), reach(Vector3.zero, 10)), event("craft")),
				"test",
			);

			expect(compiled.leaves.size()).to.equal(4);
			expect(compiled.leaves[1].target).to.equal(3);
			expect(compiled.leaves[2].objective.kind).to.equal("reach");
			expect(compiled.events.has("talk")).to.equal(true);
			expect(compiled.events.has("collect")).to.equal(true);
			expect(compiled.events.has("craft")).to.equal(true);
			expect(compiled.hasReach).to.equal(true);
		});

		it("rejects amounts that aren't whole numbers of at least 1", () => {
			expect(() => compileObjective(event("collect", 0), "quest x")).to.throw("whole amount");
			expect(() => compileObjective(event("collect", 2.5), "quest x")).to.throw("whole amount");
			expect(() => compileObjective(event("collect", 0 / 0), "quest x")).to.throw("whole amount");
		});

		it("rejects empty composites and bad radii", () => {
			expect(() => compileObjective(sequence(), "quest x")).to.throw("sequence objective has nothing");
			expect(() => compileObjective(all(), "quest x")).to.throw("all objective has nothing");
			expect(() => compileObjective(reach(Vector3.zero, 0), "quest x")).to.throw("positive radius");
		});
	});

	describe("event values", () => {
		const defeat = event("defeat", 10, { enemy: ["Titan", "Abnormal"], zone: "Wall" });

		it("counts one per event, or payload.amount when given", () => {
			const plain = event("collect", 5);
			expect(eventValue(plain, {})).to.equal(1);
			expect(eventValue(plain, { amount: 4 })).to.equal(4);
		});

		it("matches filters by value or by list", () => {
			expect(eventValue(defeat, { enemy: "Titan", zone: "Wall" })).to.equal(1);
			expect(eventValue(defeat, { enemy: "Abnormal", zone: "Wall" })).to.equal(1);
			expect(eventValue(defeat, { enemy: "Cart", zone: "Wall" })).to.equal(0);
			expect(eventValue(defeat, { enemy: "Titan", zone: "Forest" })).to.equal(0);
			expect(eventValue(defeat, { zone: "Wall" })).to.equal(0);
		});

		it("applies a custom predicate after the filter", () => {
			const fastKills: EventObjective = { ...event("defeat", 5), where: (payload) => payload.seconds === 3 };
			expect(eventValue(fastKills, { seconds: 3 })).to.equal(1);
			expect(eventValue(fastKills, { seconds: 9 })).to.equal(0);
		});

		it("reads a named field when valueKey is set and ignores events without it", () => {
			const coins: EventObjective = { ...event("earn", 500), valueKey: "coins" };
			expect(eventValue(coins, { coins: 120 })).to.equal(120);
			expect(eventValue(coins, { amount: 120 })).to.equal(0);
		});

		it("never counts negative, NaN, infinite or non-number amounts", () => {
			const plain = event("collect", 5);
			expect(eventValue(plain, { amount: -3 })).to.equal(0);
			expect(eventValue(plain, { amount: 0 / 0 })).to.equal(0);
			expect(eventValue(plain, { amount: math.huge })).to.equal(0);
			expect(eventValue(plain, { amount: "5" })).to.equal(0);
		});
	});

	describe("active leaves", () => {
		it("only lets the first unfinished step of a sequence listen", () => {
			const compiled = compileObjective(sequence(talk("A"), event("collect", 2), talk("B")), "test");
			expect(activeIndexes(compiled, [0, 0, 0])).to.equal("0");
			expect(activeIndexes(compiled, [1, 1, 0])).to.equal("1");
			expect(activeIndexes(compiled, [1, 2, 0])).to.equal("2");
			expect(activeIndexes(compiled, [1, 2, 1])).to.equal("");
		});

		it("lets every unfinished part of an all listen at once", () => {
			const compiled = compileObjective(all(event("a", 2), event("b"), event("c", 3)), "test");
			expect(activeIndexes(compiled, [0, 0, 0])).to.equal("0,1,2");
			expect(activeIndexes(compiled, [2, 0, 1])).to.equal("1,2");
		});

		it("walks sequences nested inside alls", () => {
			const compiled = compileObjective(all(sequence(event("a"), event("b")), event("c")), "test");
			expect(activeIndexes(compiled, [0, 0, 0])).to.equal("0,2");
			expect(activeIndexes(compiled, [1, 0, 1])).to.equal("1");
		});

		it("is complete only when every leaf hits its target", () => {
			const compiled = compileObjective(all(sequence(event("a"), event("b")), event("c", 2)), "test");
			expect(isComplete(compiled.root, [1, 1, 1])).to.equal(false);
			expect(isComplete(compiled.root, [1, 1, 2])).to.equal(true);
		});
	});
};
