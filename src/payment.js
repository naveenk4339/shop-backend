import crypto from 'node:crypto';

// Card number checksum used by all major card networks.
function passesLuhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export function cardBrand(digits) {
  if (/^4/.test(digits)) return 'Visa';
  if (/^(5[1-5]|2[2-7])/.test(digits)) return 'Mastercard';
  if (/^3[47]/.test(digits)) return 'American Express';
  if (/^6(011|5)/.test(digits)) return 'Discover';
  return 'Card';
}

// Returns { errors } with a message per invalid field, or { card } when valid.
export function validateCard({ name, number, expiry, cvv } = {}, now = new Date()) {
  const errors = {};
  const digits = String(number || '').replace(/[\s-]/g, '');
  const brand = cardBrand(digits);

  if (!String(name || '').trim()) errors.name = 'Enter the name on the card.';

  if (!/^\d{13,19}$/.test(digits) || !passesLuhn(digits)) {
    errors.number = 'Enter a valid card number.';
  }

  const match = /^(\d{2})\s*\/\s*(\d{2})$/.exec(String(expiry || '').trim());
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 12) {
    errors.expiry = 'Enter the expiry date as MM/YY.';
  } else {
    const month = Number(match[1]);
    const year = 2000 + Number(match[2]);
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    if (year < currentYear || (year === currentYear && month < currentMonth)) {
      errors.expiry = 'This card has expired.';
    }
  }

  const cvvLength = brand === 'American Express' ? 4 : 3;
  if (!new RegExp(`^\\d{${cvvLength}}$`).test(String(cvv || ''))) {
    errors.cvv = `Enter the ${cvvLength}-digit security code.`;
  }

  if (Object.keys(errors).length) return { errors };
  return { card: { brand, last4: digits.slice(-4), digits } };
}

// Simulated payment gateway. No money moves. Card 4000 0000 0000 0002 is
// always declined so the decline path can be tested.
export function chargeCard(card, amountCents) {
  if (card.digits === '4000000000000002') {
    return { approved: false, reason: 'Your card was declined. Try a different card.' };
  }
  if (amountCents <= 0) return { approved: false, reason: 'Nothing to charge.' };
  return { approved: true };
}

export function newOrderId() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `ORD-${date}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}
