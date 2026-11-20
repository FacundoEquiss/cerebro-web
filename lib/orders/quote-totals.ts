// The totals of an enquiry once the owner typed a price per line and the shipping. Pure and free
// of server code: the admin panel previews with it, the json adapter saves with it, and SQL
// (`set_quote`) does the same sum.

const cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function quoteTotals(lines: { quantity: number }[], prices: number[], shipping: number): { subtotal: number; shipping: number; total: number } {
  const subtotal = cents(lines.reduce((sum, l, i) => sum + cents(cents(Math.max(0, prices[i] ?? 0)) * l.quantity), 0));
  const ship = cents(Math.max(0, shipping));
  return { subtotal, shipping: ship, total: cents(subtotal + ship) };
}
