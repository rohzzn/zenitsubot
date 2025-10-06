import express from 'express';
import session from 'express-session';
import { loadConfig } from '../services/config.js';
import { configurePassport, registerAuth, ensureAuth } from './auth.js';

export function createWebServer() {
  const config = loadConfig();
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', 'public');

  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  app.use(
    session({
      secret: config.SESSION_SECRET || 'dev-secret',
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false },
    }),
  );

  configurePassport();
  registerAuth(app);

  app.get('/healthz', (_req, res) => res.status(200).send('ok'));

  app.get('/', (_req, res) => res.status(200).send('ZenitsuBot Dashboard'));
  app.get('/dashboard', ensureAuth, (req, res) => {
    const user = (req as any).user as { id: string; username: string } | undefined;
    res.status(200).json({ user });
  });

  return app;
}

if (process.env.WEB_DASHBOARD_ENABLED?.toLowerCase() === 'true') {
  const app = createWebServer();
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => console.log(`[web] listening on :${port}`));
}


