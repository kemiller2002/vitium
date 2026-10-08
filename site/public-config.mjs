// Public configuration only. Never place credentials or secrets here.
// The private intake experience fails closed until the approved HTTPS API and
// Cloudflare Turnstile site key are configured, deployed and verified.
// Canonical reporter origin: https://vitium.echelonfoundry.com/
export const publicIntake = Object.freeze({
  enabled: false,
  endpoint: "",
  turnstileSiteKey: ""
});
