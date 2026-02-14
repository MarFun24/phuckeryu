const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Version marker to confirm deployment
const WEBHOOK_VERSION = 'v5';

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
    const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL;
    if (n8nWebhookUrl) {
      try {
        const n8nPayload = {
          email: buyerEmail,
          buyerEmail: buyerEmail,
          recipientEmail: metadata.recipientEmail || '',
          firstName: metadata.firstName,
          lastName: metadata.lastName,
          certificationDate: metadata.certificationDate,
          degreeLevel: metadata.degreeLevel,
          faculty: metadata.faculty,
          achievement: metadata.achievement,
          style: metadata.style,
          paymentIntentId: paymentIntent.id,
          amountPaid: paymentIntent.amount / 100,
        };
        console.log('Sending to n8n:', JSON.stringify(n8nPayload));

        const n8nResponse = await fetch(n8nWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(n8nPayload),
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
    } else {
      console.error('N8N_WEBHOOK_URL not configured — certificate will NOT be generated or emailed');
    }
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
