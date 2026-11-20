// EXACT DECIMAL MATH for money and quantities. JavaScript numbers are binary: 3.30 × 0.75 is
// 2.4749999… and rounds to 2.47, while PostgreSQL (`numeric`) says 2.475 → 2.48. Everything that
// has to agree with the database goes through integers here, rounding HALF UP like `round(numeric, n)`.
// Dependency-free: it runs in the browser too.

/** A number as an integer of 10^-places, rounded half up on its DECIMAL digits (1.005 → 101 cents). */
export function scaled(value: number, places: number): bigint {
  if (!Number.isFinite(value)) return 0n;
  const negative = value < 0;
  // The shortest decimal text that names this number: what a person typed, what JSON carries.
  let text = Math.abs(value).toString();
  if (text.includes("e")) text = Math.abs(value).toFixed(12);
  const [whole = "0", fraction = ""] = text.split(".");
  const digits = fraction.padEnd(places + 1, "0");
  let n = BigInt(whole + digits.slice(0, places));
  if (digits.charCodeAt(places) >= 53) n += 1n; // next digit is 5 or more
  return negative ? -n : n;
}

const CENTS = 2;
const MILLIS = 3;

/** Rounds to cents, half up, on the decimal digits. */
export function roundCents(amount: number): number {
  return Number(scaled(amount, CENTS)) / 100;
}

/** Rounds a quantity to three decimals (grams in a kilo), half up. */
export function roundMillis(quantity: number): number {
  return Number(scaled(quantity, MILLIS)) / 1000;
}

/** `unit price × quantity`, rounded to cents half up — exactly `round(price * quantity, 2)` in SQL. */
export function multiplyMoney(unitPrice: number, quantity: number): number {
  const product = scaled(unitPrice, CENTS) * scaled(quantity, MILLIS); // in 10^-5
  const negative = product < 0n;
  const abs = negative ? -product : product;
  const cents = (abs + 500n) / 1000n;
  return Number(negative ? -cents : cents) / 100;
}

/** Is `quantity` a whole number of `step`s? Exact, on thousandths. */
export function isMultiple(quantity: number, step: number): boolean {
  const s = scaled(step, MILLIS);
  return s > 0n && scaled(quantity, MILLIS) % s === 0n;
}
