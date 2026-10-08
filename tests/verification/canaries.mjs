// Fake credential canaries for adversarial and browser tests (VIT-AC-008, VIT-AC-015).
// None of these is a real credential. Each is ASSEMBLED AT RUNTIME, so this file holds
// no literal that matches a credential pattern (scripts/secret-scan.mjs, GitHub push
// protection). Never inline the assembled values back into a test file.
const join = (...parts) => parts.join("");
const filler = (alphabet, n) => Array.from({ length: n }, (_, i) => alphabet[i % alphabet.length]).join("");
const ALNUM = "abcdefghijklmnopqrstuvwxyz0123456789";
const UPPER_NUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export const CANARY = Object.freeze({
  githubClassic: join("gh", "p_", filler(ALNUM, 36)),
  githubClassicShort: join("gh", "p_", "abcdefghijklmnopqrstuvwxyz0123"),
  githubFineGrained: join("github", "_pat_", "11ABCDEFG0123456789_", filler(ALNUM, 40)),
  awsAccessKeyId: join("AK", "IA", filler(UPPER_NUM, 16)),
  slackBot: join("xo", "xb-", "123456789012-1234567890123-", filler(ALNUM, 24)),
  jwt: join("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", ".", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", ".", filler(ALNUM, 43)),
  bearerHeader: join("Authorization: ", "Bea", "rer ", filler(ALNUM, 32)),
  tokenAssignment: join("tok", "en=", "abcdefghijklmnop1234"),
  openAiStyle: join("s", "k-", filler(ALNUM.slice(0, 26), 26)),
  passwordAssignment: join("pass", "word: ", "hunter2hunter2"),
  passwordWord: join("hun", "ter2")
});

/** URL carrying userinfo (user and password), assembled so the file holds no such literal URL. */
export const urlWithUserinfo = (scheme, user, password, rest) => join(scheme, "://", user, ":", password, "@", rest);
