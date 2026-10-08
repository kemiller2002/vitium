// AWS Lambda adapter. Imports are lazy so domain and HTTP tests require no AWS package.
// Production deployment requires an approved, immutable dependency bundle/lock.
import { makeIntake } from "./intake.mjs";
import { createHttpHandler } from "./http.mjs";

let cached;
async function createLiveHandler() {
  const tableName=process.env.REPORTS_TABLE_NAME;
  const secretArn=process.env.TURNSTILE_SECRET_ARN;
  const allowedOrigin=process.env.ALLOWED_ORIGIN;
  const expectedHostname=process.env.CHALLENGE_HOSTNAME;
  if (!tableName || !secretArn || allowedOrigin!=="https://vitium.echelonfoundry.com" || expectedHostname!=="vitium.echelonfoundry.com") {
    throw new Error("Vitium secure intake configuration is incomplete.");
  }
  const [{DynamoDBClient,PutItemCommand,GetItemCommand},{SecretsManagerClient,GetSecretValueCommand}] = await Promise.all([
    import("@aws-sdk/client-dynamodb"),import("@aws-sdk/client-secrets-manager")
  ]);
  const dynamo=new DynamoDBClient({});
  const secrets=new SecretsManagerClient({});
  let secret;
  async function loadSecret() {
    if (secret) return secret;
    const result=await secrets.send(new GetSecretValueCommand({SecretId:secretArn}));
    if (!result.SecretString) throw new Error("Challenge secret is unavailable.");
    secret=result.SecretString;
    return secret;
  }
  const store={
    async putOnce(item) {
      const {pk,reference,payloadHash,report,source,visibility,kind,status,receivedAt}=item;
      try {
        await dynamo.send(new PutItemCommand({
          TableName:tableName,
          Item:{
            pk:{S:pk},reference:{S:reference},payloadHash:{S:payloadHash},
            report:{S:JSON.stringify(report)},source:{S:source},
            visibility:{S:visibility},kind:{S:kind},status:{S:status},receivedAt:{S:receivedAt},
            state:{S:item.state},revision:{N:String(item.revision)},
            history:{S:JSON.stringify(item.history)},reviewQueuePk:{S:item.reviewQueuePk},
            reviewQueueSk:{S:receivedAt+"#"+reference}
          },
          ConditionExpression:"attribute_not_exists(pk)"
        }));
        return {created:true};
      } catch (error) {
        if (error?.name!=="ConditionalCheckFailedException") throw error;
        const found=await dynamo.send(new GetItemCommand({
          TableName:tableName,Key:{pk:{S:pk}},ConsistentRead:true,
          ProjectionExpression:"reference,payloadHash,receivedAt"
        }));
        if (!found.Item) throw new Error("Intake write conflict unavailable.");
        return {created:false,existing:{
          reference:found.Item.reference?.S,
          payloadHash:found.Item.payloadHash?.S,
          receivedAt:found.Item.receivedAt?.S
        }};
      }
    }
  };
  const verifyChallenge=async token=>{
    const key=await loadSecret();
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),5000);
    try {
      const body=new URLSearchParams({secret:key,response:token});
      const resp=await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify",{
        method:"POST",body,signal:controller.signal
      });
      if (!resp.ok) throw new Error("Challenge provider unavailable.");
      const data=await resp.json();
      return data.success===true &&
        data.hostname===expectedHostname &&
        data.action==="vitium-intake";
    } finally {clearTimeout(timeout);}
  };
  return createHttpHandler(makeIntake({store,verifyChallenge}),{allowedOrigin});
}
export async function handler(event) {
  try {
    cached ??= createLiveHandler();
    const handle=await cached;
    return await handle(event);
  } catch {
    return {statusCode:503,headers:{"content-type":"application/json","cache-control":"no-store"},body:JSON.stringify({code:"service_unavailable",message:"Reporting is temporarily unavailable."})};
  }
}
