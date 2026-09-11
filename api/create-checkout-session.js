const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Printed Degree Certificate (Shipped) — CAD $32.99, shipping included.
// Resolved by lookup key so pricing can change in Stripe without a redeploy;
// the price ID is only a fallback if the lookup key ever goes missing.
const PRINTED_LOOKUP_KEY = 'phuckery_printed_cert_cad';
const PRINTED_PRICE_ID = 'price_1UEa8wPVCYNIQbDADaLMVkve';

// Canada only to start. Helen's $8.60 max shipping figure is a domestic rate,
// so cross-border orders at a $32.99 flat price could lose money each time.
// Add 'US' here only once she confirms she wants cross-border orders.
const ALLOWED_COUNTRIES = ['CA'];

const SITE_URL = process.env.SITE_URL || 'https://www.phuckeryu.com';

async function resolvePriceId() {
  try {
    const prices = await stripe.prices.list({
      lookup_keys: [PRINTED_LOOKUP_KEY],
      active: true,
      limit: 1,
    });

    if (prices.data.length > 0) {
      return prices.data[0].id;
    }

    console.warn(
      `No active price found for lookup key "${PRINTED_LOOKUP_KEY}" — falling back to ${PRINTED_PRICE_ID}`
    );
  } catch (err) {
    console.warn(`Price lookup by key failed (${err.message}) — falling back to ${PRINTED_PRICE_ID}`);
  }

  return PRINTED_PRICE_ID;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      firstName,
      lastName,
      certificationDate,
      degreeLevel,
      faculty,
      achievement,
      style,
      buyerEmail,
    } = req.body;

    if (!firstName || !lastName || !certificationDate || !degreeLevel || !faculty || !achievement || !style) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!buyerEmail) {
      return res.status(400).json({ error: 'Email address is required' });
    }

    const price = await resolvePriceId();

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price, quantity: 1 }],
      customer_email: buyerEmail,
      // Physical orders ship to one address — no separate gift-recipient email.
      shipping_address_collection: { allowed_countries: ALLOWED_COUNTRIES },
      // Couriers ask for a phone number on delivery.
      phone_number_collection: { enabled: true },
      metadata: {
        fulfillment: 'physical',
        firstName,
        lastName,
        certificationDate,
        degreeLevel,
        faculty,
        // Stripe caps metadata values at 500 characters. Achievement is the only
        // free-text field (the builder lets buyers write their own), so clamp it.
        achievement: String(achievement).slice(0, 500),
        style,
        buyerEmail,
      },
      success_url: `${SITE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/`,
    });

    res.status(200).json({ url: session.url, sessionId: session.id });
  } catch (error) {
    console.error('Stripe Checkout Session error:', error);
    res.status(500).json({ error: error.message });
  }
};
