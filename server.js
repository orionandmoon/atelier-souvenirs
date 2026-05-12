require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const stripe     = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');
const rateLimit  = require('express-rate-limit');
const helmet     = require('helmet');

const app = express();

// Nécessaire pour Render (proxy) — permet au rate limiter de lire la vraie IP
app.set("trust proxy", 1);

// ─── SÉCURITÉ — Headers HTTP ──────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

// ─── CORS ─────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  process.env.FRONTEND_URL,
  'https://lateliersouvenirs.fr',
  'https://www.lateliersouvenirs.fr',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error('Origine non autorisée'));
  }
}));

// ─── RATE LIMITING ────────────────────────────────────────────────────────────
// Global : 100 requêtes / 15 min par IP
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, max: 100,
  message: { error: 'Trop de requêtes, réessayez dans quelques minutes.' },
}));

// Stripe : 10 tentatives / 10 min par IP
const stripeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: 10,
  message: { error: 'Trop de tentatives de paiement. Réessayez dans 10 minutes.' },
});

// Avis : 5 soumissions / heure par IP
const reviewLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 5,
  message: { error: 'Trop d\'avis soumis. Réessayez dans une heure.' },
});

// ─── SANITISATION ─────────────────────────────────────────────────────────────
function sanitizeString(str, maxLen = 500) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLen)
    .replace(/<[^>]*>/g, '')
    .replace(/[<>"'`;]/g, '')
    .replace(/[\x00-\x1F\x7F]/g, '');
}

function sanitizeEmail(email) {
  if (typeof email !== 'string') return '';
  const c = email.trim().toLowerCase().slice(0, 254);
  return /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(c) ? c : '';
}

function sanitizeNumber(val, min, max) {
  const n = parseInt(val);
  return (!isNaN(n) && n >= min && n <= max) ? n : null;
}

const VALID_PRODUCTS = ['Coque de téléphone', 'Magnet frigo', 'Puzzle A4'];

// ─── MAILER ───────────────────────────────────────────────────────────────────
function createMailer() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

async function sendOrderConfirmationEmail({ email, name, items, total, orderId }) {
  const mailer = createMailer();
  if (!mailer) return console.log('⚠️ SMTP non configuré');

  const safeName = sanitizeString(name, 100);
  const safeId   = sanitizeString(orderId, 50);
  const itemsHtml = items.map(i => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">${sanitizeString(i.name, 100)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center">×${sanitizeNumber(i.quantity,1,99)||1}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right">${(parseFloat(i.price)*parseInt(i.quantity)).toFixed(2)} €</td>
    </tr>`).join('');

  await mailer.sendMail({
    from: `"L'Atelier Souvenirs" <${process.env.SMTP_USER}>`,
    to: email,
    subject: `✅ Commande confirmée — L'Atelier Souvenirs`,
    html: `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#faf8f5;font-family:Arial,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:32px 16px">
  <div style="text-align:center;margin-bottom:32px">
    <div style="font-size:22px;font-weight:700;color:#2c3e35">L'Atelier <span style="color:#e05a45;font-style:italic">Souvenirs</span></div>
    <div style="font-size:12px;color:#7a7570;margin-top:4px">Création Hyéroise · Personnalisation instantanée</div>
  </div>
  <div style="background:#fff;border-radius:16px;padding:28px;margin-bottom:16px;border:1px solid #e8e4df">
    <h1 style="font-size:20px;font-weight:700;color:#2c3e35;text-align:center;margin:0 0 8px">✅ Commande confirmée !</h1>
    <p style="font-size:14px;color:#7a7570;text-align:center;margin:0 0 20px">Bonjour ${safeName}, merci pour votre commande !</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
      <thead><tr style="background:#faf8f5">
        <th style="padding:8px 12px;text-align:left;font-size:12px;color:#7a7570">Produit</th>
        <th style="padding:8px 12px;text-align:center;font-size:12px;color:#7a7570">Qté</th>
        <th style="padding:8px 12px;text-align:right;font-size:12px;color:#7a7570">Prix</th>
      </tr></thead>
      <tbody>${itemsHtml}</tbody>
      <tfoot><tr>
        <td colspan="2" style="padding:12px;font-weight:700;color:#2c3e35">Total TTC</td>
        <td style="padding:12px;font-weight:700;color:#c49a3c;text-align:right;font-size:18px">${parseFloat(total).toFixed(2)} €</td>
      </tr></tfoot>
    </table>
    <div style="background:#faf8f5;border-radius:10px;padding:16px;font-size:13px;color:#2c3e35;line-height:2">
      🎨 Fabrication en cours (1-3 jours ouvrés)<br>
      📦 Expédition sous 3-5 jours ouvrés<br>
      🚚 Livraison Mondial Relay à domicile
    </div>
  </div>
  <div style="background:#fff;border-radius:16px;padding:24px;text-align:center;border:1px solid #e8e4df;margin-bottom:16px">
    <h2 style="font-size:16px;font-weight:700;color:#2c3e35;margin:0 0 8px">⭐ Votre avis compte !</h2>
    <p style="font-size:13px;color:#7a7570;margin:0 0 16px">Une fois votre colis reçu, partagez votre expérience !</p>
    <a href="${process.env.FRONTEND_URL}/review.html" style="display:inline-block;background:#e05a45;color:#fff;text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:600;font-size:14px">✍️ Laisser un avis</a>
  </div>
  <div style="text-align:center;font-size:11px;color:#7a7570;padding-top:16px">
    <p>© 2025 L'Atelier Souvenirs · Création Hyéroise</p>
    <p style="margin-top:4px">Réf. : #${safeId.slice(-8).toUpperCase()}</p>
  </div>
</div></body></html>`
  });
  console.log(`📧 Email envoyé à ${email}`);
}

// ─── WEBHOOKS STRIPE (raw body — doit être AVANT express.json) ───────────────
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object;
    const clientEmail = sanitizeEmail(pi.metadata.client_email || '');
    console.log(`✅ Paiement reçu : ${(pi.amount/100).toFixed(2)}€ — ${clientEmail || 'N/A'}`);

    if (clientEmail) {
      try {
        const items = JSON.parse(pi.metadata.items_json || '[]');
        await sendOrderConfirmationEmail({
          email: clientEmail,
          name: pi.metadata.client_nom || 'Client',
          items, total: pi.amount / 100, orderId: pi.id,
        });
      } catch(e) { console.error('Erreur email :', e.message); }
    }
  }
  res.json({ received: true });
});

// ─── JSON (limite taille body à 10kb) ────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));

// ─── PAYMENT INTENT ──────────────────────────────────────────────────────────
app.post('/create-payment-intent', stripeLimiter, async (req, res) => {
  const { amount, currency = 'eur', metadata = {} } = req.body;

  const safeAmount = sanitizeNumber(amount, 50, 999900);
  if (!safeAmount) return res.status(400).json({ error: 'Montant invalide' });
  if (!['eur'].includes(currency)) return res.status(400).json({ error: 'Devise non supportée' });

  // Sanitiser les metadata
  const safeMetadata = {};
  ['client_nom','client_email','produit','nb_articles','livraison','items_json'].forEach(k => {
    if (metadata[k]) safeMetadata[k] = sanitizeString(String(metadata[k]), 500);
  });

  try {
    const pi = await stripe.paymentIntents.create({
      amount: safeAmount, currency,
      automatic_payment_methods: { enabled: true },
      metadata: safeMetadata,
    });
    res.json({ clientSecret: pi.client_secret });
  } catch (err) {
    console.error('Erreur PaymentIntent :', err.message);
    res.status(500).json({ error: 'Erreur lors de la création du paiement' });
  }
});

// ─── AVIS CLIENT ─────────────────────────────────────────────────────────────
app.post('/submit-review', reviewLimiter, async (req, res) => {
  const { rating, name, product, text, email, orderRef, photo } = req.body;

  // Extraire et valider la photo
  let photoBuffer = null;
  let photoMime = null;
  if (photo && typeof photo === 'string' && photo.startsWith('data:image')) {
    const matches = photo.match(/^data:(image\/(jpeg|png|webp));base64,(.+)$/);
    if (matches && matches[3].length < 7 * 1024 * 1024) { // max ~5Mo base64
      photoMime = matches[1];
      photoBuffer = Buffer.from(matches[3], 'base64');
    }
  }

  const safeRating  = sanitizeNumber(rating, 1, 5);
  const safeName    = sanitizeString(name, 50);
  const safeProduct = VALID_PRODUCTS.includes(product) ? product : null;
  const safeText    = sanitizeString(text, 500);
  const safeEmail   = email ? sanitizeEmail(email) : '';
  const safeRef     = orderRef ? sanitizeString(orderRef, 100) : '';

  if (!safeRating)  return res.status(400).json({ error: 'Note invalide' });
  if (!safeName)    return res.status(400).json({ error: 'Prénom invalide' });
  if (!safeProduct) return res.status(400).json({ error: 'Produit invalide' });
  if (!safeText || safeText.length < 10) return res.status(400).json({ error: 'Commentaire trop court' });

  console.log(`⭐ Avis reçu : ${safeRating}/5 — ${safeName} — ${safeProduct}`);

  const mailer = createMailer();
  if (mailer && process.env.OWNER_EMAIL) {
    try {
      const stars = '★'.repeat(safeRating) + '☆'.repeat(5 - safeRating);
      await mailer.sendMail({
        from: `"L'Atelier Souvenirs" <${process.env.SMTP_USER}>`,
        to: process.env.OWNER_EMAIL,
        subject: `⭐ Nouvel avis — ${stars} — ${safeName}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <h2 style="color:#2c3e35">Nouvel avis reçu !</h2>
          <div style="background:#faf8f5;border-radius:12px;padding:20px;margin:16px 0">
            <div style="font-size:22px;color:#f5c842">${stars}</div>
            <strong style="font-size:16px;color:#2c3e35">${safeName}</strong>
            <span style="background:#e8e4df;padding:3px 10px;border-radius:10px;font-size:12px;margin-left:8px">${safeProduct}</span>
            <p style="color:#444;margin-top:12px;line-height:1.6">« ${safeText} »</p>
            ${safeEmail ? `<p style="font-size:12px;color:#7a7570">Email : ${safeEmail}</p>` : ''}
            ${safeRef ? `<p style="font-size:12px;color:#7a7570">Commande : #${safeRef.slice(-8).toUpperCase()}</p>` : ''}
          </div>
        </div>`
      });
    } catch(e) { console.error('Erreur email avis :', e.message); }
  }

  res.json({ success: true });
});

// ─── SANTÉ ───────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: "L'Atelier Souvenirs API", secure: true });
});

// ─── GESTION ERREURS ─────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Erreur :', err.message);
  res.status(500).json({ error: 'Erreur interne du serveur' });
});

// ─── DÉMARRAGE ───────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur le port ${PORT}`);
  console.log(`   Stripe   : ${process.env.STRIPE_SECRET_KEY ? '✅' : '❌'}`);
  console.log(`   SMTP     : ${process.env.SMTP_HOST ? '✅' : '⚠️  non configuré'}`);
  console.log(`   Sécurité : ✅ Helmet + Rate Limiting + Sanitisation`);
});
