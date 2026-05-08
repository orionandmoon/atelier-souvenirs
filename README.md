# L'Atelier Souvenirs — Backend Stripe

Backend Node.js/Express pour gérer les paiements Stripe de L'Atelier Souvenirs.

---

## Déploiement sur Render (gratuit)

### 1. Créer un compte GitHub et uploader le code

1. Va sur [github.com](https://github.com) → crée un compte gratuit
2. Crée un nouveau dépôt : **New repository** → nom : `atelier-souvenirs-backend` → Public → **Create**
3. Upload les fichiers : clique **Add file → Upload files** → glisse tous les fichiers de ce dossier
4. Clique **Commit changes**

### 2. Créer un compte Stripe

1. Va sur [stripe.com](https://stripe.com) → **Créer un compte**
2. Dans le dashboard, reste en **mode Test** pour commencer
3. Va dans **Developers → API keys**
4. Copie la **clé secrète** (commence par `sk_test_...`)

### 3. Déployer sur Render

1. Va sur [render.com](https://render.com) → **Get Started for Free**
2. **New → Web Service**
3. Connecte ton dépôt GitHub `atelier-souvenirs-backend`
4. Configure :
   - **Name** : `atelier-souvenirs-backend`
   - **Runtime** : Node
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
   - **Plan** : Free
5. Dans **Environment Variables**, ajoute :
   - `STRIPE_SECRET_KEY` → ta clé secrète Stripe
   - `FRONTEND_URL` → `https://amazing-marzipan-df0685.netlify.app`
   - `NODE_ENV` → `production`
6. Clique **Create Web Service**
7. Render te donne une URL comme `https://atelier-souvenirs-backend.onrender.com`

### 4. Configurer le Webhook Stripe

1. Dans Stripe → **Developers → Webhooks → Add endpoint**
2. URL : `https://atelier-souvenirs-backend.onrender.com/webhook`
3. Events : sélectionne `payment_intent.succeeded`
4. Copie le **Signing secret** (commence par `whsec_...`)
5. Dans Render → **Environment Variables** → ajoute `STRIPE_WEBHOOK_SECRET`

### 5. Brancher le frontend

Dans le fichier `js/stripe.js` du site, remplace :
```
YOUR_PUBLISHABLE_KEY → ta clé publique Stripe (pk_test_...)
/create-payment-intent → https://atelier-souvenirs-backend.onrender.com/create-payment-intent
```

---

## Test

Carte de test : `4242 4242 4242 4242` — date future — CVC : `123`

---

## Notifications

À chaque paiement réussi tu reçois :
- ✅ Un email de Stripe automatiquement
- ✅ Une notification sur l'app Stripe (iOS/Android)
- ✅ Le détail dans le dashboard stripe.com
