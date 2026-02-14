const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    // Vercel auto-parses JSON bodies and the bodyParser:false config
    // is ignored due to ESM-to-CJS compilation. Use req.body directly.
    let rawBody;
    if (req.body) {
      rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      console.log('Using Vercel-parsed req.body, length:', rawBody.length);
    } else {
      // Fallback: read from stream if body parser is actually disabled
      rawBody = await new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
      });
      console.log('Using raw stream, length:', rawBody.length);
    }

    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    console.log('Webhook signature verified successfully');
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
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
};

// Disable Vercel's automatic body parsing — Stripe needs the raw body
// for webhook signature verification
module.exports.config = {
  api: {
    bodyParser: false,
  },
};
