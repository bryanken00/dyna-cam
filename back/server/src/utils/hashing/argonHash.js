import argon2 from "argon2";
import crypto from "node:crypto";
import APIError from "../APIError.js";

// OWASP-recommended Argon2id parameters (memoryCost in KiB → 19 MiB).
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 3, // Iterations
  parallelism: 1, // Threads
};

// Returns the encoded Argon2id hash string. The salt is generated internally
// by argon2 and embedded in the hash — there is no separate salt to store.
export const hashPassword = async (password) => {
  try {
    return await argon2.hash(password, ARGON2_OPTIONS);
  } catch (_error) {
    throw new APIError(
      "An error occurred while generating new hash password",
      500
    );
  }
};

// Function to compare the provided password with the stored hash
// (argon2.verify reads the algorithm type and salt from the encoded hash
// string itself — passing them as options is ignored, so we don't)
export const comparePassword = async (password, storedHash) => {
  try {
    return await argon2.verify(storedHash, password);
  } catch (_err) {
    // If there's an error (e.g., verification failure), return false
    return false;
  }
};

// A real hash of a random password, made once at startup. A malformed literal
// makes argon2.verify throw in ~1 ms, so an unknown email would answer faster
// than a known one and reveal which emails have accounts.
const dummyHash = argon2.hash(crypto.randomBytes(32).toString("hex"), ARGON2_OPTIONS);

// Spends the same time as a real comparison, always false. Use when there is no
// stored hash to compare against (e.g. login for an unknown email).
export const compareDummyPassword = async (password) => {
  await comparePassword(password, await dummyHash);
  return false;
};
