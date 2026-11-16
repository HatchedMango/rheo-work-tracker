export function goalProgress(count: number, target: number) {
  const over = Math.max(0, count - target);
  return {
    percent: Math.min(count < target ? 99 : Infinity, Math.round((count / target) * 100)),
    over,
    remaining: Math.max(0, target - count),
    goalFraction: Math.min(1, count / target),
    bonusFraction: Math.min(1, over / target),
  };
}
