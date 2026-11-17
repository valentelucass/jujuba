export function bowCharge(distance: number, seconds: number) {
  const stretch = Math.min(1, Math.max(0, distance) / 520)
  const boost = Math.min(1, Math.max(0, seconds - .5) / 3.5) * Math.min(1, stretch / .45)
  return { stretch, boost, power: stretch + boost * .9 }
}
