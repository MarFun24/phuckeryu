const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
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
      buyerEmail,
      recipientEmail,
      style,
      priceId
    } = req.body;

    // Validate required fields
    if (!firstName || !lastName || !certificationDate || !degreeLevel || !faculty || !achievement || !style) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!buyerEmail) {
      return res.status(400).json({ error: 'Email address is required' });
    }

    // Create Payment Intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: 999, // $9.99 in cents
      currency: 'usd',
      payment_method_types: ['card'],
      receipt_email: buyerEmail,
      metadata: {
        firstName,
        lastName,
        certificationDate,
        degreeLevel,
        faculty,
        achievement,
        buyerEmail,
        recipientEmail: recipientEmail || '',
        style,
      },
    });

    res.status(200).json({ 
      clientSecret: paymentIntent.client_secret 
    });
    
  } catch (error) {
    console.error('Stripe error:', error);
    res.status(500).json({ error: error.message });
  }
};
