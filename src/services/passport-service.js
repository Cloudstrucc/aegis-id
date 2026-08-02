const LocalStrategy = require('passport-local').Strategy;

const { getUserById, verifyUserPassword } = require('./auth-service');

function configurePassport(passport) {
  passport.use(
    new LocalStrategy(
      {
        usernameField: 'email',
        passwordField: 'password'
      },
      async (email, password, done) => {
        try {
          const user = await verifyUserPassword(email, password);
          return done(null, user || false, user ? undefined : { message: 'Invalid email or password.' });
        } catch (error) {
          return done(error);
        }
      }
    )
  );

  // The issue time travels with the session so a password reset can invalidate
  // every session that predates it. Without it, resetting a password would
  // leave whoever already had access still signed in.
  passport.serializeUser((user, done) => {
    done(null, { id: user.id, issuedAt: new Date().toISOString() });
  });

  passport.deserializeUser(async (stored, done) => {
    try {
      // Sessions created before this change serialized a bare id string.
      const id = typeof stored === 'string' ? stored : stored?.id;
      const issuedAt = typeof stored === 'string' ? null : stored?.issuedAt;
      const user = await getUserById(id);

      if (user?.sessionsValidFrom) {
        const cutoff = new Date(user.sessionsValidFrom).getTime();
        const established = issuedAt ? new Date(issuedAt).getTime() : 0;
        if (established < cutoff) {
          return done(null, false);
        }
      }

      return done(null, user);
    } catch (error) {
      return done(error);
    }
  });
}

module.exports = { configurePassport };
