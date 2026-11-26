import fs from "fs";
import passport from "passport";
import { ExtractJwt, Strategy as JwtStrategy } from "passport-jwt";
import path from "path";

import { JWT_AUDIENCE, JWT_ISSUER } from "../utils/jwt.js";

// Function to configure Passport with JWT strategy
const configurePassport = (db) => {
  // Reading the public key from the file system for verifying JWT signature
  const publicKey = fs.readFileSync(path.resolve(`${process.env.jwtAuthPublicPath}`), "utf-8");

  // Setting up options for the JWT strategy
  const opts = {};
  opts.jwtFromRequest = ExtractJwt.fromAuthHeaderAsBearerToken(); // Extract JWT from the Bearer token in the Authorization header
  opts.secretOrKey = publicKey; // Using the public key to verify the JWT
  // Same constants token signing uses (utils/jwt.js) — a mismatch here would
  // make every token fail verification
  opts.issuer = JWT_ISSUER;
  opts.audience = JWT_AUDIENCE;
  opts.algorithms = ["RS256"]; // Only accept RS256 algorithm tokens

  // Using the JWT strategy with Passport
  passport.use(
    "jwt",
    new JwtStrategy(opts, async (jwt_payload, done) => {
      const { userId, exp } = jwt_payload; //destructuring data
      const currentTime = Math.floor(Date.now() / 1000); // Current time in seconds

      // Check if the token is expired manually (optional; passport-jwt does this too)
      if (exp && exp < currentTime) {
        return done(null, false, { message: "Token has expired" });
      }

      try {
        const rows = await db.query(
          `SELECT u.accountId, u.companyId, u.firstName, u.lastName, u.roleId, u.status,
                  c.email, c.type, c.mustChangePassword
           FROM users u
           INNER JOIN credentials c ON c.accountId = u.accountId
           -- PLAN-008: a suspended (or deleted) company's staff tokens stop working
           INNER JOIN companies co ON co.companyId = u.companyId AND co.status = 'Active'
           WHERE u.accountId = ? AND u.status != 'Deleted' AND c.status != 'Deleted'
           LIMIT 1`,
          [userId]
        );
        const user = rows[0];

        if (!user) {
          return done(null, false, { message: "User not found" });
        }

        // Check if the user's account is active
        if (user.status !== "Active") {
          return done(null, false, {
            message: "Your account has been deactivated. Contact admin for reactivation.",
          });
        }

        // If user exists and is active, pass the user data to the next middleware
        // (TINYINT flag → boolean, so req.user and the /me response carry true/false)
        return done(null, { ...user, mustChangePassword: Boolean(user.mustChangePassword) });
      } catch (error) {
        // passing error to the done callback
        done(error, null);
      }
    })
  );
};

// Exporting the function to be used in other parts of the app

export default configurePassport;
