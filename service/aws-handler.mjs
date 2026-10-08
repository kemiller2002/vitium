// AWS Lambda composition root. Imports are lazy so domain and HTTP tests require no AWS
// package. Production deployment requires an approved, immutable dependency bundle/lock:
// today the SDK is the one shipped in the Lambda nodejs22.x runtime (see
// docs/decisions/SEC-002-aws-sdk-supply-chain.md).
import { makeIntake } from "./intake.mjs";
import { createHttpHandler } from "./http.mjs";
import { makeDynamoStore } from "./adapters/dynamodb-store.mjs";
import { makeTurnstileVerifier } from "./adapters/turnstile-challenge.mjs";
import { makeJsonLogger, intakeLogRecord } from "./adapters/safe-log.mjs";
import { intakeFailure, failureBody } from "./errors.mjs";

const CANONICAL_ORIGIN = "https://vitium.echelonfoundry.com";
const CHALLENGE_HOST = "vitium.echelonfoundry.com";
// H-01: a staging stack may use one dedicated https subdomain of the canonical site host.
const STAGING_HOST = /^[a-z0-9-]+\.vitium\.echelonfoundry\.com$/;

/** Pure: is (origin, host) acceptable for this environment? Anything but staging is canonical-only. */
export function originAllowed({environment, origin, host}) {
  if (origin === CANONICAL_ORIGIN && host === CHALLENGE_HOST) return true;
  return environment === "staging" && typeof host === "string" && STAGING_HOST.test(host) && origin === "https://" + host;
}

/** Pure: environment -> Result<config>. Exact-match values; no defaults for secrets. */
export function readConfig(env) {
  const config = {
    tableName: env.REPORTS_TABLE_NAME, secretArn: env.TURNSTILE_SECRET_ARN,
    allowedOrigin: env.ALLOWED_ORIGIN, expectedHostname: env.CHALLENGE_HOSTNAME
  };
  const complete = typeof config.tableName === "string" && config.tableName &&
    typeof config.secretArn === "string" && /^arn:aws[a-zA-Z-]*:secretsmanager:/.test(config.secretArn) &&
    originAllowed({environment: env.ENVIRONMENT_NAME, origin: config.allowedOrigin, host: config.expectedHostname});
  return complete ? {ok:true, value:Object.freeze(config)} : {ok:false, error:"configuration_incomplete"};
}

/** Compose the live handler from explicit effects. Exported for wiring tests. */
export function composeHandler({config, dynamo, commands, loadSecret, fetch, log}) {
  const store = makeDynamoStore({client:dynamo, tableName:config.tableName, commands});
  const verifyChallenge = makeTurnstileVerifier({fetch, loadSecret, expectedHostname:config.expectedHostname});
  return createHttpHandler(makeIntake({store, verifyChallenge}), {allowedOrigin:config.allowedOrigin, log});
}

async function createLiveHandler(env) {
  const config = readConfig(env);
  if (!config.ok) return config;
  const [{DynamoDBClient, PutItemCommand, GetItemCommand}, {SecretsManagerClient, GetSecretValueCommand}] = await Promise.all([
    import("@aws-sdk/client-dynamodb"), import("@aws-sdk/client-secrets-manager")
  ]);
  const secrets = new SecretsManagerClient({});
  // Cache only a successful secret read; a failed read is retried on the next request.
  let cachedSecret;
  const loadSecret = async () => {
    if (cachedSecret) return cachedSecret;
    const result = await secrets.send(new GetSecretValueCommand({SecretId:config.value.secretArn}));
    if (!result.SecretString) throw new Error("secret unavailable");
    cachedSecret = result.SecretString;
    return cachedSecret;
  };
  return {ok:true, value:composeHandler({
    config:config.value, dynamo:new DynamoDBClient({}), commands:{PutItemCommand, GetItemCommand},
    loadSecret, fetch:globalThis.fetch, log:makeJsonLogger(line => console.log(line))
  })};
}

const unavailable = () => {
  const error = intakeFailure("service_unavailable");
  return {statusCode:error.status, headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}, body:JSON.stringify(failureBody(error))};
};

let cached;
export async function handler(event) {
  try {
    cached ??= createLiveHandler(process.env);
    const live = await cached;
    if (!live.ok) {
      cached = undefined; // configuration may be corrected without a cold start being required
      console.log(JSON.stringify(intakeLogRecord({status:503, code:"configuration_incomplete", category:"unavailable"})));
      return unavailable();
    }
    return await live.value(event);
  } catch {
    cached = undefined;
    console.log(JSON.stringify(intakeLogRecord({status:503, code:"service_unavailable", category:"unavailable"})));
    return unavailable();
  }
}
