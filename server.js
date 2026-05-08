require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();

// ─── CORS ────────────────────────────────────────────────────────────────────
// Autorise ton site Netlify + localhost pour les tests
const ALLOWED_ORIGINS = [
  process.env.FRONTEND_URL,          // ex: https://amazing-marzipan-df0685.netlify.app
  'http://localhost:5500',
  'http://127.0.0.1:5500',
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error('Origine non autorisée : ' + origin));
  }
}));

// ─── WEBHOOKS STRIPE (doit être avant express.json) ──────────────────────────
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig    = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    console.error('Webhook signature invalide :', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object;
    console.log('✅ Paiement reçu !');
    console.log('   Montant    :', (pi.amount / 100).toFixed(2), '€');
    console.log('   Client     :', pi.metadata.client_email || 'N/A');
    console.log('   Produit    :', pi.metadata.produit      || 'N/A');
    console.log('   Variante   :', pi.metadata.variante     || 'N/A');
    console.log('   Texte      :', pi.metadata.texte        || 'Aucun');
    console.log('   Note       :', pi.metadata.note         || 'Aucune');
    // Ici tu pourras ajouter : envoi email, enregistrement en BDD, etc.
  }

  res.json({ received: true });
});

// ─── JSON pour les autres routes ─────────────────────────────────────────────
app.use(express.json());

// ─── CRÉER UN PAYMENT INTENT ─────────────────────────────────────────────────
app.post('/create-payment-intent', async (req, res) => {
  const { amount, currency = 'eur', metadata = {} } = req.body;

  if (!amount || amount < 50) {
    return res.status(400).json({ error: 'Montant invalide (minimum 0,50 €)' });
  }

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount:   Math.round(amount), // en centimes
      currency,
      automatic_payment_methods: { enabled: true },
      metadata, // infos commande : produit, client, texte perso…
    });

    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error('Erreur PaymentIntent :', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── SANTÉ DU SERVEUR ────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: "L'Atelier Souvenirs API", env: process.env.NODE_ENV || 'development' });
});

// ─── DÉMARRAGE ───────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Serveur L'Atelier Souvenirs démarré sur le port ${PORT}`);
  console.log(`   Mode : ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Stripe : ${process.env.STRIPE_SECRET_KEY ? '✅ clé configurée' : '❌ clé manquante'}`);
});
