// Chromium selection for the browser suite. Pure decision function plus one
// optional effect (resolving the npm-hosted @sparticuz/chromium binary).
//
// CI: Playwright downloads its own Chromium (`npx playwright install chromium`)
//     and no executablePath is set.
// Local, where the Playwright CDN is blocked:
//     npm i --no-save @sparticuz/chromium@153.0.0
//     VITIUM_LOCAL_CHROMIUM=sparticuz npm run test:browser
// or  VITIUM_CHROMIUM_EXECUTABLE=/path/to/chrome npm run test:browser

// @sparticuz/chromium targets AWS Lambda and ships flags that weaken browser
// security (same-origin policy, mixed content, site isolation). Those would make
// CSP/isolation observations meaningless, so they are never forwarded.
const UNSAFE_FLAG = /^--(disable-web-security|allow-running-insecure-content|disable-site-isolation-trials|disable-features=.*(IsolateOrigins|site-per-process)|headless)/;
const KEEP_FLAG = /^--(no-sandbox|no-zygote|use-gl=|use-angle=|enable-unsafe-swiftshader|in-process-gpu|ignore-gpu-blocklist|font-render-hinting=)/;

/** Pure: filter a vendor flag list down to rendering/sandbox flags only. */
export const safeLaunchArgs = args =>
  Object.freeze(args.filter(a => KEEP_FLAG.test(a) && !UNSAFE_FLAG.test(a)));

/** Pure: decide the launch source from environment variables. */
export function chooseChromium(env) {
  if (env.VITIUM_CHROMIUM_EXECUTABLE) {
    return { ok: true, value: { kind: "explicit", executablePath: env.VITIUM_CHROMIUM_EXECUTABLE } };
  }
  if (env.VITIUM_LOCAL_CHROMIUM === "sparticuz") return { ok: true, value: { kind: "sparticuz" } };
  if (env.VITIUM_LOCAL_CHROMIUM) return { ok: false, error: "Unknown VITIUM_LOCAL_CHROMIUM=" + env.VITIUM_LOCAL_CHROMIUM };
  return { ok: true, value: { kind: "playwright-managed" } };
}

/** Effect: resolve launch options. Returns {ok,value:{launchOptions,label}} or {ok:false,error}. */
export async function resolveChromium(env, importer = specifier => import(specifier)) {
  const choice = chooseChromium(env);
  if (!choice.ok) return choice;
  const { kind } = choice.value;
  if (kind === "playwright-managed") return { ok: true, value: { label: kind, launchOptions: {} } };
  if (kind === "explicit") {
    return { ok: true, value: { label: kind, launchOptions: { executablePath: choice.value.executablePath, args: ["--no-sandbox"] } } };
  }
  try {
    const mod = await importer("@sparticuz/chromium");
    const chromium = mod.default ?? mod;
    const executablePath = await chromium.executablePath();
    return { ok: true, value: { label: "sparticuz", launchOptions: { executablePath, args: [...safeLaunchArgs(chromium.args)] } } };
  } catch (error) {
    return { ok: false, error: "Could not resolve @sparticuz/chromium: " + (error?.message ?? String(error)) };
  }
}
