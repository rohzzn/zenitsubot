import express, { type Request, type Response, type NextFunction } from 'express';
import passport from 'passport';
import { Strategy as DiscordStrategy, type Profile } from 'passport-discord';
import { loadConfig } from '../services/config.js';

type UserSession = {
  id: string;
  username: string;
  discriminator?: string;
  avatar?: string | null;
};

export function configurePassport() {
  const cfg = loadConfig();

  passport.serializeUser((user: any, done) => done(null, user as UserSession));
  passport.deserializeUser((obj: any, done) => done(null, obj as UserSession));

  if (!cfg.DISCORD_CLIENT_ID || !cfg.DISCORD_CLIENT_SECRET) return;

  passport.use(
    new DiscordStrategy(
      {
        clientID: cfg.DISCORD_CLIENT_ID,
        clientSecret: cfg.DISCORD_CLIENT_SECRET,
        callbackURL: cfg.OAUTH_CALLBACK_URL || 'http://localhost:3000/auth/callback',
        scope: ['identify', 'guilds'],
      },
      (accessToken: string, _refresh: string, profile: Profile, done) => {
        const user: UserSession = {
          id: profile.id,
          username: profile.username,
          discriminator: (profile as any).discriminator,
          avatar: profile.avatar,
        };
        return done(null, user);
      },
    ),
  );
}

export function registerAuth(app: express.Express) {
  app.use(passport.initialize());
  app.use(passport.session());

  app.get('/auth/login', passport.authenticate('discord'));

  app.get(
    '/auth/callback',
    passport.authenticate('discord', { failureRedirect: '/login-failed', successRedirect: '/dashboard' }),
  );

  app.get('/logout', (req, res) => {
    req.logout(() => {
      res.redirect('/');
    });
  });

  app.get('/login-failed', (_req, res) => res.status(401).send('Login failed'));
}

export function ensureAuth(req: Request, res: Response, next: NextFunction) {
  const isAuthed = (req as any).isAuthenticated?.();
  if (isAuthed) return next();
  return res.redirect('/auth/login');
}


