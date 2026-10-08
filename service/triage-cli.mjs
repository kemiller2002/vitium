#!/usr/bin/env node
/**
 * Internal operator-only review. Uses AWS IAM credentials from the environment.
 * There is deliberately no public HTTP route or embedded access key.
 * This CLI is provisional until Fides-governed triage is installed.
 */
import {transition} from "./triage.mjs";

const [command,...args]=process.argv.slice(2);
const options=Object.fromEntries(args.filter(x=>x.startsWith("--")&&x.includes("=")).map(x=>{
 const cut=x.indexOf("=");return [x.slice(2,cut),x.slice(cut+1)];
}));
const table=process.env.REPORTS_TABLE_NAME;
if (!["queue","show","advance"].includes(command) || !table) {
  process.stderr.write("Usage: REPORTS_TABLE_NAME=<private table> node service/triage-cli.mjs queue | show --key=REQUEST#<hash> | advance --key=REQUEST#<hash> --to=<state> --reason=<reason> [--classification=<type>] [--evidence=<id>]\n");
  process.exitCode=2;
} else {
  const {DynamoDBClient,GetItemCommand,QueryCommand,UpdateItemCommand}=await import("@aws-sdk/client-dynamodb");
  const {STSClient,GetCallerIdentityCommand}=await import("@aws-sdk/client-sts");
  const sts=new STSClient({});
  const identity=await sts.send(new GetCallerIdentityCommand({}));
  if (!identity.Arn) throw new Error("AWS identity is unavailable.");
  const db=new DynamoDBClient({});
  const pk=options.key;
  const validKey=typeof pk==="string" && /^REQUEST#[0-9a-f]{64}$/.test(pk);

  if (command==="queue") {
    const result=await db.send(new QueryCommand({
      TableName:table, IndexName:"ReviewQueue",
      KeyConditionExpression:"#queue = :queue",
      ExpressionAttributeNames:{"#queue":"reviewQueuePk"},
      ExpressionAttributeValues:{":queue":{S:"QUEUE#pending"}},
      Limit:50
    }));
    // Expose only primary keys, not unreviewed confidential report bodies.
    const keys=(result.Items||[]).map(x=>x.pk?.S).filter(Boolean);
    process.stdout.write(JSON.stringify({pendingKeys:keys,partialPage:Boolean(result.LastEvaluatedKey)},null,2)+"\n");
  } else if (!validKey) {
    process.stderr.write("A valid private record key is required.\n");
    process.exitCode=2;
  } else {
    const item=(await db.send(new GetItemCommand({
      TableName:table,Key:{pk:{S:pk}},ConsistentRead:true
    }))).Item;
    if (!item || item.kind?.S!=="observation") throw new Error("Observation not found or not reviewable.");
    if (command==="show") {
      // Authenticated operator command. Never run in public CI output.
      process.stdout.write(JSON.stringify({
        reference:item.reference?.S,receivedAt:item.receivedAt?.S,
        state:item.state?.S,revision:Number(item.revision?.N),
        report:JSON.parse(item.report?.S||"{}"),
        history:JSON.parse(item.history?.S||"[]")
      },null,2)+"\n");
    } else {
      if (!options.to || !options.reason) throw new Error("Target state and reason are required.");
      const current={
        kind:"observation",state:item.state?.S,
        revision:Number(item.revision?.N),
        history:JSON.parse(item.history?.S||"[]")
      };
      const changed=transition(current,{
        to:options.to,expectedRevision:current.revision,
        actor:identity.Arn,role:"triager",reason:options.reason,
        classification:options.classification,
        evidenceId:options.evidence,
        occurredAt:new Date().toISOString()
      });
      const terminal=["classified","rejected"].includes(changed.state);
      const names={"#state":"state"};
      const values={
        ":next":{S:changed.state},":before":{S:current.state},
        ":version":{N:String(changed.revision)},":expected":{N:String(current.revision)},
        ":history":{S:JSON.stringify(changed.history)}
      };
      await db.send(new UpdateItemCommand({
        TableName:table,Key:{pk:{S:pk}},
        ConditionExpression:"attribute_exists(pk) AND revision = :expected AND #state = :before",
        UpdateExpression:"SET #state = :next, revision = :version, history = :history" +
          (terminal ? " REMOVE reviewQueuePk, reviewQueueSk" : ""),
        ExpressionAttributeNames:names,ExpressionAttributeValues:values
      }));
      process.stdout.write(JSON.stringify({reference:item.reference?.S,state:changed.state,revision:changed.revision,actor:identity.Arn})+"\n");
    }
  }
}
