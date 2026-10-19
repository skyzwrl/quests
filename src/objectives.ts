export type FilterValue = string | number | boolean;

export type Filter = { readonly [key: string]: FilterValue | readonly FilterValue[] };

export type EventPayload = { readonly [key: string]: unknown };

export interface EventMatcher {
	readonly event: string;
	readonly filter?: Filter;
	readonly where?: (payload: EventPayload) => boolean;
	// payload field to count by. without it an event counts payload.amount when that's a number, else 1
	readonly valueKey?: string;
}

export interface EventObjective extends EventMatcher {
	readonly kind: "event";
	readonly amount: number;
}

export interface ReachObjective {
	readonly kind: "reach";
	readonly position: Vector3;
	readonly radius: number;
}

export interface SequenceObjective {
	readonly kind: "sequence";
	readonly steps: readonly Objective[];
}

export interface AllObjective {
	readonly kind: "all";
	readonly parts: readonly Objective[];
}

export type Objective = EventObjective | ReachObjective | SequenceObjective | AllObjective;

export function event(name: string, amount = 1, filter?: Filter): EventObjective {
	return { kind: "event", event: name, amount, filter };
}

export function talk(npc: string): EventObjective {
	return event("talk", 1, { npc });
}

export function reach(position: Vector3, radius: number): ReachObjective {
	return { kind: "reach", position, radius };
}

export function sequence(...steps: Objective[]): SequenceObjective {
	return { kind: "sequence", steps };
}

export function all(...parts: Objective[]): AllObjective {
	return { kind: "all", parts };
}

export interface Leaf {
	readonly index: number;
	readonly objective: EventObjective | ReachObjective;
	readonly target: number;
}

export type ObjectiveNode =
	| { readonly kind: "leaf"; readonly leaf: Leaf }
	| { readonly kind: "sequence" | "all"; readonly children: readonly ObjectiveNode[] };

export interface CompiledObjective {
	readonly root: ObjectiveNode;
	readonly leaves: readonly Leaf[];
	readonly events: ReadonlySet<string>;
	readonly hasReach: boolean;
}

// objectives are flattened into numbered leaves so progress saves as a plain number array, and composites
// work out which leaves are live from that array instead of storing their own step index
export function compileObjective(objective: Objective, owner: string): CompiledObjective {
	const leaves: Leaf[] = [];
	const events = new Set<string>();
	let hasReach = false;

	const visit = (node: Objective): ObjectiveNode => {
		if (node.kind === "event") {
			if (!(node.amount >= 1 && node.amount % 1 === 0)) {
				throw `${owner}: "${node.event}" objective needs a whole amount of at least 1, got ${node.amount}`;
			}
			events.add(node.event);
		} else if (node.kind === "reach") {
			if (!(node.radius > 0 && node.radius < math.huge)) {
				throw `${owner}: reach objective needs a positive radius, got ${node.radius}`;
			}
			hasReach = true;
		} else {
			const children = node.kind === "sequence" ? node.steps : node.parts;
			if (children.isEmpty()) {
				throw `${owner}: ${node.kind} objective has nothing in it`;
			}
			return { kind: node.kind, children: children.map(visit) };
		}

		const leaf: Leaf = { index: leaves.size(), objective: node, target: node.kind === "event" ? node.amount : 1 };
		leaves.push(leaf);
		return { kind: "leaf", leaf };
	};

	return { root: visit(objective), leaves, events, hasReach };
}

export function isComplete(node: ObjectiveNode, progress: readonly number[]): boolean {
	if (node.kind === "leaf") {
		return progress[node.leaf.index] >= node.leaf.target;
	}
	for (const child of node.children) {
		if (!isComplete(child, progress)) {
			return false;
		}
	}
	return true;
}

// a sequence only listens through its first unfinished step, so one event never finishes two steps at once
export function collectActiveLeaves(node: ObjectiveNode, progress: readonly number[], out: Leaf[]): void {
	if (node.kind === "leaf") {
		if (progress[node.leaf.index] < node.leaf.target) {
			out.push(node.leaf);
		}
	} else if (node.kind === "sequence") {
		for (const child of node.children) {
			if (!isComplete(child, progress)) {
				collectActiveLeaves(child, progress, out);
				return;
			}
		}
	} else {
		for (const child of node.children) {
			collectActiveLeaves(child, progress, out);
		}
	}
}

export function matchesFilter(filter: Filter, payload: EventPayload): boolean {
	for (const [key, expected] of pairs(filter)) {
		const actual = payload[key];
		if (typeIs(expected, "table")) {
			if (!(expected as readonly FilterValue[]).includes(actual as FilterValue)) {
				return false;
			}
		} else if (actual !== expected) {
			return false;
		}
	}
	return true;
}

export function eventValue(matcher: EventMatcher, payload: EventPayload): number {
	if (matcher.filter !== undefined && !matchesFilter(matcher.filter, payload)) {
		return 0;
	} else if (matcher.where !== undefined && !matcher.where(payload)) {
		return 0;
	}

	const raw = matcher.valueKey !== undefined ? payload[matcher.valueKey] : (payload.amount ?? 1);
	// whatever a caller passes, negative, NaN or infinite amounts never move progress
	return typeIs(raw, "number") && raw > 0 && raw < math.huge ? raw : 0;
}
