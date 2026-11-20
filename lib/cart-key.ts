/**
 * Key of a cart line. With a variant, it is the variant id. WITHOUT one — a product that declares
 * options (size, colour) but has no generated variants yet — the product id alone is not enough:
 * two different sizes would collapse into one line. The choice is appended, in the order the
 * product declares its options, so the same choice always gives the same key.
 *
 * It is an INTERNAL key of the storefront (cart de-duplication). The server receives
 * `productId` / `variantId` / `selection`, never this.
 */
export function lineKey(
  productId: string,
  variantId?: string | null,
  selection: Record<string, string> = {},
  optionOrder: readonly string[] = Object.keys(selection).sort(),
  slot?: string | null,
): string {
  // Two different appointments of the same service are two different lines.
  const at = slot ? `@${slot}` : "";
  if (variantId) return `${variantId}${at}`;
  const extra = optionOrder
    .map((id) => selection[id])
    .filter((v): v is string => Boolean(v))
    .join("|");
  return `${extra ? `${productId}|${extra}` : productId}${at}`;
}
