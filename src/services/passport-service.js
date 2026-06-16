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

  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id, done) => {
    try {
      done(null, await getUserById(id));
    } catch (error) {
      done(error);
    }
  });
}

module.exports = { configurePassport };
