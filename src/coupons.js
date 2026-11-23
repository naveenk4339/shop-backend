// Promo codes the store accepts. Discounts are always worked out here, on the
// server, from the shopper's saved cart, never taken from the browser.
const COUPONS = {
  SAVE10: { label: '10% off your order', percent: 10 },
  WELCOME5: { label: '$5 off orders of $25 or more', amountCents: 500, minCents: 2500 },
};

// Returns { code, label, discountCents } or { error } for a code and cart subtotal.
export function applyCoupon(rawCode, subtotalCents) {
  const code = String(rawCode || '').trim().toUpperCase();
  const coupon = COUPONS[code];
  if (!coupon) return { error: 'That promo code is not valid.' };
  if (coupon.minCents && subtotalCents < coupon.minCents) {
    return { error: `${code} needs an order of at least $${(coupon.minCents / 100).toFixed(2)}.` };
  }
  const discountCents = coupon.percent
    ? Math.round((subtotalCents * coupon.percent) / 100)
    : Math.min(coupon.amountCents, subtotalCents);
  return { code, label: coupon.label, discountCents };
}
