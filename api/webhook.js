const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    // Verify webhook signature
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
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
        await fetch(n8nWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
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
          }),
        });
        console.log('Order data sent to n8n successfully');
      } catch (n8nError) {
        console.error('Failed to send to n8n:', n8nError.message);
        // Don't fail the webhook — Stripe needs a 200 response
      }
    } else {
      console.warn('N8N_WEBHOOK_URL not configured — skipping n8n notification');
    }
  }

  res.status(200).json({ received: true });
};
