import express from 'express';
import session from 'express-session';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import ejs from 'ejs';
import { loadConfig } from '../services/config.js';
import { configurePassport, registerAuth, ensureAuth } from './auth.js';
import { db } from '../services/db.js';
import { verifyKey } from 'discord-interactions';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createWebServer() {
  const config = loadConfig();
  const app = express();

  // View engine setup
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '../../public/views'));

  // CORS for GitHub Pages frontend
  app.use(cors({
    origin: [
      'https://zenitsu.rohan.host', // Custom domain on GitHub Pages
      'http://zenitsu.rohan.host',
      'http://localhost:3000',
      'http://localhost:5500',
      'http://192.168.1.232'
    ],
    credentials: true
  }));

  // Middleware
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '../../public')));

  app.use(
    session({
      secret: config.SESSION_SECRET || 'dev-secret',
      resave: false,
      saveUninitialized: false,
      cookie: { 
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        httpOnly: true,
      },
    }),
  );

  // Make user available to all templates
  app.use((req, res, next) => {
    res.locals.user = (req as any).user || null;
    next();
  });

  configurePassport();
  registerAuth(app);

  // Health check
  app.get('/healthz', (_req, res) => res.status(200).send('ok'));

  // Landing page
  app.get('/', (req, res) => {
    const user = (req as any).user;
    const indexContent = readFileSync(path.join(__dirname, '../../public/views/index.ejs'), 'utf8');
    res.render('layout', {
      title: 'Home',
      body: ejs.render(indexContent, { user }),
    });
  });

  // Dashboard
  app.get('/dashboard', ensureAuth, async (req, res) => {
    const user = (req as any).user as { id: string; username: string; discriminator?: string; avatar?: string };

    try {
      // Fetch user's economy data
      const economy = await db.user.findUnique({
        where: { userId: user.id },
        select: { balance: true, bank: true },
      });

      // Fetch user's anime alerts
      const animeAlerts = await db.animeAlert
        .findMany({
          where: { userId: user.id },
          select: { title: true, animeId: true },
          take: 5,
        })
        .catch(() => []);

      const dashboardContent = readFileSync(path.join(__dirname, '../../public/views/dashboard.ejs'), 'utf8');

      res.render('layout', {
        title: 'Dashboard',
        user,
        body: ejs.render(dashboardContent, {
          user,
          economy,
          animeAlerts,
          guilds: [],
        }),
      });
    } catch (error) {
      console.error('Dashboard error:', error);
      res.status(500).send('Error loading dashboard');
    }
  });

  // Terms of Service
  app.get('/terms-of-service', (_req, res) => {
    const termsContent = readFileSync(path.join(__dirname, '../../public/views/terms.ejs'), 'utf8');
    res.render('layout', {
      title: 'Terms of Service',
      body: termsContent,
    });
  });

  // Privacy Policy
  app.get('/privacy-policy', (_req, res) => {
    const privacyContent = readFileSync(path.join(__dirname, '../../public/views/privacy.ejs'), 'utf8');
    res.render('layout', {
      title: 'Privacy Policy',
      body: privacyContent,
    });
  });

  // Linked Roles Verification
  app.get('/verify-user', (req, res) => {
    const user = (req as any).user;
    const verifyContent = readFileSync(path.join(__dirname, '../../public/views/verify.ejs'), 'utf8');

    res.render('layout', {
      title: 'Verify Account',
      body: ejs.render(verifyContent, {
        user,
        verified: false,
        error: null,
      }),
    });
  });

  app.post('/verify-user', ensureAuth, async (req, res) => {
    const user = (req as any).user as { id: string; username: string };

    try {
      // Store verification in database
      await db.user.upsert({
        where: { userId: user.id },
        update: { linkedRolesVerified: true },
        create: {
          userId: user.id,
          balance: 0,
          bank: 0,
          linkedRolesVerified: true,
        },
      });

      const verifyContent = readFileSync(path.join(__dirname, '../../public/views/verify.ejs'), 'utf8');

      res.render('layout', {
        title: 'Account Verified',
        body: ejs.render(verifyContent, {
          user,
          verified: true,
          error: null,
        }),
      });
    } catch (error) {
      console.error('Verification error:', error);
      const verifyContent = readFileSync(path.join(__dirname, '../../public/views/verify.ejs'), 'utf8');

      res.render('layout', {
        title: 'Verification Error',
        body: ejs.render(verifyContent, {
          user,
          verified: false,
          error: 'An error occurred during verification. Please try again.',
        }),
      });
    }
  });

  // Discord Interactions Endpoint
  app.post('/api/interactions', async (req, res) => {
    const signature = req.get('X-Signature-Ed25519');
    const timestamp = req.get('X-Signature-Timestamp');
    const publicKey = config.DISCORD_PUBLIC_KEY;

    if (!signature || !timestamp || !publicKey) {
      return res.status(401).send('Invalid request signature');
    }

    try {
      const isValidRequest = verifyKey(JSON.stringify(req.body), signature, timestamp, publicKey);

      if (!isValidRequest) {
        return res.status(401).send('Invalid request signature');
      }

      // Handle PING
      if (req.body.type === 1) {
        return res.send({ type: 1 });
      }

      // For now, return a message that interactions should use Gateway
      res.send({
        type: 4,
        data: {
          content: 'This bot uses Gateway for interactions. Please use slash commands in Discord.',
        },
      });
    } catch (error) {
      console.error('Interaction verification error:', error);
      res.status(401).send('Invalid request');
    }
  });

  // API endpoints for GitHub Pages frontend
  app.get('/api/user', (req, res) => {
    if (req.isAuthenticated && req.isAuthenticated()) {
      res.json(req.user);
    } else {
      res.status(401).json({ error: 'Not authenticated' });
    }
  });

  app.get('/api/economy/:userId', async (req, res) => {
    try {
      const { userId } = req.params;
      const user = await db.user.findUnique({
        where: { userId }
      });
      res.json({ balance: user?.balance || 0, bank: user?.bank || 0 });
    } catch (error) {
      console.error('Error fetching economy:', error);
      res.status(500).json({ error: 'Failed to fetch economy data' });
    }
  });

  return app;
}

if (process.env.WEB_DASHBOARD_ENABLED?.toLowerCase() === 'true') {
  const app = createWebServer();
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => console.log(`[web] listening on :${port}`));
}


