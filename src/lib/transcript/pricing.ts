/** USD per million tokens: [input, output]. Cache read bills at 0.1x input, cache write at 1.25x. */
const PRICES: Array<[prefix: string, input: number, output: number]> = [
  ["claude-fable", 10, 50],
  ["claude-mythos", 10, 50],
  ["claude-opus", 5, 25],
  ["claude-sonnet", 3, 15],
  ["claude-haiku", 1, 5],
];

export function priceFor(model: string): { input: number; output: number } | null {
  const hit = PRICES.find(([prefix]) => model.startsWith(prefix));
  return hit ? { input: hit[1], output: hit[2] } : null;
}
