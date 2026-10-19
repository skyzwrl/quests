export function isFiniteNumber(value: unknown): value is number {
	return typeIs(value, "number") && value > -math.huge && value < math.huge;
}

export function isWholeAtLeast(value: unknown, minimum: number): value is number {
	return isFiniteNumber(value) && value >= minimum && value % 1 === 0;
}
