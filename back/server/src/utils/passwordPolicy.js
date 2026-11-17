/**
 * Password policy
 *
 * Length is enforced by the validators (`newPassword()` in
 * validators/_helpers.js). This file adds what length cannot: a password must
 * not be one everybody tries first, and must not be built from the account's
 * own email. Nothing is sent to an outside service.
 *
 * The list is the well-known weak passwords of 8+ characters (shorter ones are
 * already refused by the length rule). It is a floor, not a guarantee — add to
 * it freely; entries are compared lower-cased.
 */

const COMMON_PASSWORDS = new Set([
  // digits and keyboard walks
  "12345678",
  "123456789",
  "1234567890",
  "12345678910",
  "0123456789",
  "87654321",
  "987654321",
  "0987654321",
  "11111111",
  "00000000",
  "12341234",
  "123123123",
  "12344321",
  "11223344",
  "147258369",
  "123456789a",
  "a123456789",
  "123456abc",
  "abc12345",
  "abcd1234",
  "abc123456",
  "a1b2c3d4",
  "1q2w3e4r",
  "1q2w3e4r5t",
  "q1w2e3r4",
  "q1w2e3r4t5",
  "1qaz2wsx",
  "1qaz2wsx3edc",
  "zaq12wsx",
  "qazwsxedc",
  "qwertyui",
  "qwertyuiop",
  "qwerty12",
  "qwerty123",
  "qwerty1234",
  "qwerty12345",
  "asdfghjk",
  "asdfghjkl",
  "asdfasdf",
  "zxcvbnm1",
  "zxcvbnm123",
  // "password" and friends
  "password",
  "password1",
  "password2",
  "password12",
  "password123",
  "password1234",
  "password!",
  "password1!",
  "password@123",
  "passw0rd",
  "passw0rd1",
  "p@ssw0rd",
  "p@ssword",
  "p@ssw0rd1",
  "p@ssword1",
  "p@ssw0rd123",
  "pa$$w0rd",
  "pass1234",
  "pass12345",
  "mypassword",
  "changeme",
  "changeme1",
  "changeme123",
  "letmein1",
  "letmein123",
  "welcome1",
  "welcome12",
  "welcome123",
  "welcome@123",
  "secret123",
  "default1",
  "default123",
  "temp1234",
  "temp12345",
  "test1234",
  "test12345",
  "testtest",
  "testing123",
  // roles and accounts
  "admin123",
  "admin1234",
  "admin12345",
  "admin@123",
  "administrator",
  "superadmin",
  "superadmin1",
  "superadmin123",
  "superuser",
  "root1234",
  "user1234",
  "guest123",
  "login123",
  "manager1",
  "manager123",
  // words people reach for
  "iloveyou",
  "iloveyou1",
  "iloveyou2",
  "iloveyou12",
  "iloveyou123",
  "sunshine",
  "sunshine1",
  "princess",
  "princess1",
  "football",
  "football1",
  "baseball",
  "baseball1",
  "basketball",
  "superman",
  "superman1",
  "starwars",
  "whatever",
  "trustno1",
  "computer",
  "computer1",
  "internet",
  "monkey123",
  "dragon123",
  "master123",
  "shadow123",
  "michael1",
  "jordan23",
  "charlie1",
  "michelle",
  "jennifer",
  "samantha",
  "victoria",
  "elizabeth",
  "alexander",
  "benjamin",
  "mercedes",
  "corvette",
  "maverick",
  "liverpool",
  "chocolate",
  "butterfly",
  // local favourites
  "mahalkita",
  "mahalkita1",
  "pilipinas",
  "philippines",
  "pogiako1",
  "pogiako123",
]);

// One character repeated ("aaaaaaaa"), or a plain run of consecutive digits
const isTrivialPattern = (value) =>
  /^(.)\1+$/.test(value) ||
  "01234567890123456789".includes(value) ||
  "98765432109876543210".includes(value);

/**
 * @param {string} password - the new password, exactly as typed
 * @param {{ email?: string }} [account] - whose password it is
 * @returns {string|null} why the password is refused, or null when it is fine
 */
export const passwordProblem = (password, { email } = {}) => {
  const lowered = password.toLowerCase();

  if (COMMON_PASSWORDS.has(lowered) || isTrivialPattern(lowered)) {
    return "This password is too common. Please choose a different one.";
  }

  // "juan.delacruz@x.com" → refuse a password that contains "juan.delacruz"
  const emailName = (email || "").split("@")[0].toLowerCase();
  if (emailName.length >= 4 && lowered.includes(emailName)) {
    return "Password must not contain your email name.";
  }

  return null;
};
