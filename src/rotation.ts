// numerical recipes lcg. every intermediate product stays under 2^53, so doubles keep it exact and
// every server (and every test) picks the same offers for the same period
const MULTIPLIER = 1664525;
const INCREMENT = 1013904223;
const MODULUS = 4294967296;
const SPREAD = 2654435761;

export function rotationSeed(period: number, seed: number): number {
	// spreading the period keeps consecutive days from starting the lcg on neighbouring states
	let state = (period * SPREAD + seed) % MODULUS;
	for (let warmup = 0; warmup < 4; warmup++) {
		state = (state * MULTIPLIER + INCREMENT) % MODULUS;
	}
	return state;
}

export function pickRotation(pool: readonly string[], count: number, seed: number): string[] {
	const picked = [...pool];
	if (count >= picked.size()) {
		return picked;
	}

	// partial fisher-yates: only the first `count` slots need to be settled
	let state = seed;
	for (let index = 0; index < count; index++) {
		state = (state * MULTIPLIER + INCREMENT) % MODULUS;
		const other = index + math.floor((state / MODULUS) * (picked.size() - index));
		const swapped = picked[other];
		picked[other] = picked[index];
		picked[index] = swapped;
	}

	const offers: string[] = [];
	for (let index = 0; index < count; index++) {
		offers.push(picked[index]);
	}
	return offers;
}
