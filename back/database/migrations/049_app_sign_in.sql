-- 049_app_sign_in.sql
-- PLAN-009 phase A: the DGSports mobile app signs players in with Google through the
-- same /api/v1/auth/google flow, coming back to the app (dgsports://signed-in). The app
-- sends a PKCE-style challenge (base64url SHA-256 of a secret it keeps); the single-use
-- sign-in code is then redeemable only with that secret, so another app catching the
-- redirect can't use it. NULL = a web sign-in (no challenge, as before).

ALTER TABLE player_sign_in_codes
  ADD COLUMN challenge VARCHAR(64) NULL AFTER playerId;
