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
    const customerEmail = paymentIntent.receipt_email || paymentIntent.charges?.data[0]?.billing_details?.email;

    console.log('Payment successful!');
    console.log('Customer email:', customerEmail);
    console.log('Order details:', metadata);
    console.log('Amount paid:', paymentIntent.amount / 100);

    // TODO: Send this data to n8n webhook
    // For now, we'll just log it
    // Later you'll add:
    // await fetch('YOUR_N8N_WEBHOOK_URL', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({
    //     email: customerEmail,
    //     ...metadata,
    //     paymentIntentId: paymentIntent.id,
    //     amountPaid: paymentIntent.amount / 100
    //   })
    // });
  }

  res.status(200).json({ received: true });
};
