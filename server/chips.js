// Missing markers belong to existing rooms and retain their original unit.
export const chipUnit = room => room?.chipUnit === 5 ? 5 : 1;
export function requireChipMultiple(amount, unit) {
  if (amount % unit !== 0) throw Error(`筹码必须为 ${unit} 的倍数`);
  return amount;
}
export function potShare(amount, winners, index, unit) {
  const units = amount / unit;
  return (Math.floor(units / winners) + (index < units % winners ? 1 : 0)) * unit;
}
