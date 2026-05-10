require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const stripe     = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');
const rateLimit  = require('express-rate-limit');
const helmet     = require('helmet');

const app = express();

app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

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
    cb(new Error('Origine non autorisee'));
  }
}));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000, max: 100,
  message: { error: 'Trop de requetes, reessayez dans quelques minutes.' },
}));

const stripeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: 10,
  message: { error: 'Trop de tentatives de paiement. Reessayez dans 10 minutes.' },
});

const reviewLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 5,
  message: { error: 'Trop avis soumis. Reessayez dans une heure.' },
});

function sanitizeString(str, maxLen) {
  if (maxLen === undefined) maxLen = 500;
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLen)
    .replace(/<[^>]*>/g, '')
    .replace(/[<>"'`;]/g, '')
    .replace(/[\x00-\x1F\x7F]/g, '');
}

function sanitizeEmail(email) {
  if (typeof email !== 'string') return '';
  var c = email.trim().toLowerCase().slice(0, 254);
  return /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(c) ? c : '';
}

function sanitizeNumber(val, min, max) {
  var n = parseInt(val);
  return (!isNaN(n) && n >= min && n <= max) ? n : null;
}

var VALID_PRODUCTS = ['Coque de telephone', 'Magnet frigo', 'Puzzle A4'];

function createMailer() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

async function sendOrderConfirmationEmail(opts) {
  var email = opts.email, name = opts.name, items = opts.items, total = opts.total, orderId = opts.orderId;
  var mailer = createMailer();
  if (!mailer) return console.log('SMTP non configure');
  var safeName = sanitizeString(name, 100);
  var safeId = sanitizeString(orderId, 50);
  var itemsHtml = items.map(function(i) {
    return '<tr><td style="padding:8px 12px;border-bottom:1px solid #eee">' + sanitizeString(i.name, 100) + '</td>' +
    '<td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center">x' + (sanitizeNumber(i.quantity,1,99)||1) + '</td>' +
    '<td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right">' + (parseFloat(i.price)*parseInt(i.quantity)).toFixed(2) + ' EUR</td></tr>';
  }).join('');
  await mailer.sendMail({
    from: '"L Atelier Souvenirs" <' + process.env.SMTP_USER + '>',
    to: email,
    subject: 'Commande confirmee - L Atelier Souvenirs',
    html: '<div style="max-width:560px;margin:0 auto;padding:32px 16px;font-family:Arial,sans-serif">' +
      '<h1 style="color:#2c3e35">Commande confirmee !</h1>' +
      '<p>Bonjour ' + safeName + ', merci pour votre commande.</p>' +
      '<table style="width:100%;border-collapse:collapse"><thead><tr>' +
      '<th style="padding:8px;text-align:left">Produit</th><th>Qte</th><th>Prix</th>' +
      '</tr></thead><tbody>' + itemsHtml + '</tbody><tfoot><tr>' +
      '<td colspan="2" style="padding:12px;font-weight:700">Total TTC</td>' +
      '<td style="padding:12px;font-weight:700;text-align:right">' + parseFloat(total).toFixed(2) + ' EUR</td>' +
      '</tr></tfoot></table>' +
      '<p>Fabrication : 1-3 jours. Expedition : 3-5 jours.</p>' +
      '<a href="' + process.env.FRONTEND_URL + '/review.html" style="display:inline-block;background:#e05a45;color:#fff;text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:600">Laisser un avis</a>' +
      '<p style="font-size:11px;color:#7a7570">Ref : #' + safeId.slice(-8).toUpperCase() + '</p></div>'
  });
  console.log('Email envoye a ' + email);
}

app.post('/webhook', express.raw({ type: 'application/json' }), async function(req, res) {
  var sig = req.headers['stripe-signature'];
  var event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send('Webhook Error: ' + err.message);
  }
  if (event.type === 'payment_intent.succeeded') {
    var pi = event.data.object;
    var clientEmail = sanitizeEmail(pi.metadata.client_email || '');
    console.log('Paiement recu : ' + (pi.amount/100).toFixed(2) + 'EUR');
    if (clientEmail) {
      try {
        var items = JSON.parse(pi.metadata.items_json || '[]');
        await sendOrderConfirmationEmail({ email: clientEmail, name: pi.metadata.client_nom || 'Client', items: items, total: pi.amount / 100, orderId: pi.id });
      } catch(e) { console.error('Erreur email :', e.message); }
    }
  }
  res.json({ received: true });
});

app.use(express.json({ limit: '10kb' }));

app.post('/create-payment-intent', stripeLimiter, async function(req, res) {
  var amount = req.body.amount, currency = req.body.currency || 'eur', metadata = req.body.metadata || {};
  var safeAmount = sanitizeNumber(amount, 50, 999900);
  if (!safeAmount) return res.status(400).json({ error: 'Montant invalide' });
  if (currency !== 'eur') return res.status(400).json({ error: 'Devise non supportee' });
  var safeMetadata = {};
  ['client_nom','client_email','produit','nb_articles','livraison','items_json'].forEach(function(k) {
    if (metadata[k]) safeMetadata[k] = sanitizeString(String(metadata[k]), 500);
  });
  try {
    var pi = await stripe.paymentIntents.create({ amount: safeAmount, currency: currency, automatic_payment_methods: { enabled: true }, metadata: safeMetadata });
    res.json({ clientSecret: pi.client_secret });
  } catch (err) {
    console.error('Erreur PaymentIntent :', err.message);
    res.status(500).json({ error: 'Erreur creation paiement' });
  }
});

app.post('/submit-review', reviewLimiter, async function(req, res) {
  var rating = req.body.rating, name = req.body.name, product = req.body.product;
  var text = req.body.text, email = req.body.email, orderRef = req.body.orderRef;
  var safeRating  = sanitizeNumber(rating, 1, 5);
  var safeName    = sanitizeString(name, 50);
  var safeProduct = VALID_PRODUCTS.includes(product) ? product : null;
  var safeText    = sanitizeString(text, 500);
  var safeEmail   = email ? sanitizeEmail(email) : '';
  var safeRef     = orderRef ? sanitizeString(orderRef, 100) : '';
  if (!safeRating)  return res.status(400).json({ error: 'Note invalide' });
  if (!safeName)    return res.status(400).json({ error: 'Prenom invalide' });
  if (!safeProduct) return res.status(400).json({ error: 'Produit invalide' });
  if (!safeText || safeText.length < 10) return res.status(400).json({ error: 'Commentaire trop court' });
  console.log('Avis recu : ' + safeRating + '/5 - ' + safeName);
  var mailer = createMailer();
  if (mailer && process.env.OWNER_EMAIL) {
    try {
      await mailer.sendMail({
        from: '"L Atelier Souvenirs" <' + process.env.SMTP_USER + '>',
        to: process.env.OWNER_EMAIL,
        subject: 'Nouvel avis ' + safeRating + '/5 - ' + safeName,
        html: '<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">' +
          '<h2 style="color:#2c3e35">Nouvel avis !</h2>' +
          '<p><strong>' + safeName + '</strong> - ' + safeProduct + ' - ' + safeRating + '/5</p>' +
          '<p>' + safeText + '</p>' +
          (safeEmail ? '<p>Email : ' + safeEmail + '</p>' : '') + '</div>'
      });
    } catch(e) { console.error('Erreur email avis :', e.message); }
  }
  res.json({ success: true });
});

app.get('/health', function(req, res) {
  res.json({ status: 'ok', service: "L'Atelier Souvenirs API", secure: true });
});

app.use(function(err, req, res, next) {
  console.error('Erreur :', err.message);
  res.status(500).json({ error: 'Erreur interne du serveur' });
});

var PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log('Serveur demarre sur le port ' + PORT);
  console.log('Stripe : ' + (process.env.STRIPE_SECRET_KEY ? 'OK' : 'MANQUANT'));
  console.log('Securite : Helmet + Rate Limiting + Sanitisation + Trust Proxy actifs');
});
