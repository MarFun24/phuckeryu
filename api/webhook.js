const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Version marker to confirm deployment
const WEBHOOK_VERSION = 'v6';

/**
 * Pull the shipping details off a Checkout Session.
 *
 * Stripe moved this field: API versions from 2025-03-31.basil onward expose it as
 * `collected_information.shipping_details`, older versions as `shipping_details`.
 * The event payload is rendered at whatever version the account/endpoint is pinned
 * to, which we can't inspect from here, so read both shapes rather than guess.
 */
function extractShippingDetails(session) {
  return session?.collected_information?.shipping_details || session?.shipping_details || null;
}

/**
 * Flatten a Checkout Session's address into the flat keys n8n expects, so the
 * email templates there stay simple expressions instead of nested lookups.
 * Every field defaults to '' — never undefined, which would render literally
 * as "undefined" in Helen's print order email.
 */
function flattenShipping(session) {
  const shipping = extractShippingDetails(session);
  const address = shipping?.address || {};
  const customer = session?.customer_details || {};

  return {
    shippingName: shipping?.name || customer.name || '',
    shippingLine1: address.line1 || '',
    shippingLine2: address.line2 || '',
    shippingCity: address.city || '',
    shippingState: address.state || '',
    shippingPostalCode: address.postal_code || '',
    shippingCountry: address.country || '',
    shippingPhone: customer.phone || '',
  };
}

/**
 * POST the order to n8n, which generates the PDF and routes it to the right
 * place. Never throws — Stripe needs a 200 back regardless.
 */
async function sendToN8n(payload) {
  const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL;

  if (!n8nWebhookUrl) {
    console.error('N8N_WEBHOOK_URL not configured — certificate will NOT be generated or delivered');
    return;
  }

  try {
    console.log('Sending to n8n:', JSON.stringify(payload));

    const n8nResponse = await fetch(n8nWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const responseText = await n8nResponse.text();

    if (!n8nResponse.ok) {
      console.error(`n8n responded with ${n8nResponse.status}: ${responseText}`);
    } else {
      console.log('Order data sent to n8n successfully. Response:', responseText);
    }
  } catch (n8nError) {
    console.error('Failed to send to n8n:', n8nError.message);
    // Don't fail the webhook — Stripe needs a 200 response
  }
}

// Read the raw body from the request stream as a Buffer
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function handler(req, res) {
  console.log(`[webhook ${WEBHOOK_VERSION}] Incoming ${req.method} request`);
  console.log(`[webhook ${WEBHOOK_VERSION}] req.body type: ${typeof req.body}, defined: ${req.body !== undefined}`);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    // With bodyParser:false, the stream is unconsumed — read raw bytes.
    // If bodyParser is still active, req.body will be defined and the
    // stream will be empty, so we fall back to JSON.stringify.
    const rawBody = await readRawBody(req);
    console.log(`[webhook ${WEBHOOK_VERSION}] Stream body length: ${rawBody.length}`);

    let payload;
    if (rawBody.length > 0) {
      payload = rawBody;
      console.log(`[webhook ${WEBHOOK_VERSION}] Using raw stream bytes`);
    } else if (typeof req.body === 'string') {
      payload = req.body;
      console.log(`[webhook ${WEBHOOK_VERSION}] Fallback: req.body as string`);
    } else if (Buffer.isBuffer(req.body)) {
      payload = req.body;
      console.log(`[webhook ${WEBHOOK_VERSION}] Fallback: req.body as Buffer`);
    } else if (req.body) {
      payload = JSON.stringify(req.body);
      console.log(`[webhook ${WEBHOOK_VERSION}] Fallback: stringified req.body`);
    } else {
      throw new Error('No request body available');
    }

    event = stripe.webhooks.constructEvent(payload, sig, webhookSecret);
    console.log(`[webhook ${WEBHOOK_VERSION}] Signature verified successfully`);
  } catch (err) {
    console.error(`[webhook ${WEBHOOK_VERSION}] Verification failed:`, err.message);
    return res.status(400).send(`[${WEBHOOK_VERSION}] Webhook Error: ${err.message}`);
  }

  // Handle the event
  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object;

    // Extract metadata and customer email
    const metadata = paymentIntent.metadata;
    const buyerEmail = metadata.buyerEmail || paymentIntent.receipt_email || paymentIntent.charges?.data[0]?.billing_details?.email;

    console.log('Payment successful!');
    console.log('Buyer email:', buyerEmail);
    console.log('Recipient email:', metadata.recipientEmail);
    console.log('Order details:', metadata);
    console.log('Amount paid:', paymentIntent.amount / 100);

    // Send order data to n8n webhook for certificate generation & email delivery
    await sendToN8n({
      email: buyerEmail,
      buyerEmail: buyerEmail,
      recipientEmail: metadata.recipientEmail || '',
      // Digital is the historical path. Send the flag explicitly so n8n's
      // "Is Physical?" branch never has to reason about an undefined value.
      fulfillment: metadata.fulfillment || 'digital',
      firstName: metadata.firstName,
      lastName: metadata.lastName,
      certificationDate: metadata.certificationDate,
      degreeLevel: metadata.degreeLevel,
      faculty: metadata.faculty,
      achievement: metadata.achievement,
      style: metadata.style,
      paymentIntentId: paymentIntent.id,
      amountPaid: paymentIntent.amount / 100,
    });
  }

  // Physical orders go through Stripe Checkout, which is what collects the
  // shipping address and phone number.
  if (event.type === 'checkout.session.completed') {
    let session = event.data.object;

    if (session.payment_status !== 'paid') {
      console.log(
        `[webhook ${WEBHOOK_VERSION}] Checkout session ${session.id} is ${session.payment_status}, not fulfilling yet`
      );
      return res.status(200).json({ received: true });
    }

    // If the event was rendered at an API version that predates
    // `collected_information`, re-fetch the session: the SDK pins its own
    // (newer) version, so the retrieve gives us the modern shape.
    if (!extractShippingDetails(session)) {
      try {
        console.log(
          `[webhook ${WEBHOOK_VERSION}] No shipping details on the event payload — re-fetching session ${session.id}`
        );
        session = await stripe.checkout.sessions.retrieve(session.id);
      } catch (retrieveError) {
        console.error(
          `[webhook ${WEBHOOK_VERSION}] Failed to re-fetch session: ${retrieveError.message}`
        );
      }
    }

    const metadata = session.metadata || {};
    const buyerEmail = session.customer_details?.email || metadata.buyerEmail || '';
    const shipping = flattenShipping(session);

    if (!shipping.shippingLine1) {
      console.error(
        `[webhook ${WEBHOOK_VERSION}] Session ${session.id} has no shipping address — Helen will need to chase ${buyerEmail}`
      );
    }

    console.log('Checkout session completed!');
    console.log('Buyer email:', buyerEmail);
    console.log('Fulfillment:', metadata.fulfillment);
    console.log('Amount paid:', (session.amount_total || 0) / 100);

    await sendToN8n({
      email: buyerEmail,
      buyerEmail: buyerEmail,
      // Physical orders ship to a single address — there is no gift-recipient
      // email on this path, so this stays empty.
      recipientEmail: '',
      fulfillment: metadata.fulfillment || 'physical',
      firstName: metadata.firstName,
      lastName: metadata.lastName,
      certificationDate: metadata.certificationDate,
      degreeLevel: metadata.degreeLevel,
      faculty: metadata.faculty,
      achievement: metadata.achievement,
      style: metadata.style,
      ...shipping,
      checkoutSessionId: session.id,
      paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : '',
      amountPaid: (session.amount_total || 0) / 100,
    });
  }

  res.status(200).json({ received: true });
}

// Disable Vercel's body parser so we can access the raw request body
// for Stripe webhook signature verification
handler.config = {
  api: {
    bodyParser: false,
  },
};

module.exports = handler;
