#!/usr/bin/env node
/**
 * Internal operator-only review. Uses AWS IAM credentials from the environment.
 * There is deliberately no public HTTP route or embedded access key.
 * Provisional until Fides-governed triage is installed: today, ANY principal whose IAM
 * policy allows Query/GetItem/UpdateItem on the table acts as role "triager". The
 * least-privilege operator policy is documented in docs/security/INTAKE-THREAT-MODEL.md.
 *
 * Structure: pure argument parsing / record decoding / update planning, plus one
 * `runTriage` orchestration that receives every effect (db client, identity, clock,
 * output streams) explicitly. Only the bottom of this file touches process/AWS.
 */
import {transition} from "./triage.mjs";

export const QUEUES = Object.freeze({pending:"QUEUE#pending", quarantined:"QUEUE#quarantined"});
const TERMINAL = new Set(["classified","rejected"]);
const KEY = /^REQUEST#[0-9a-f]{64}$/;
const usage = "Usage: REPORTS_TABLE_NAME=<private table> node service/triage-cli.mjs queue [--queue=pending|quarantined] | show --key=REQUEST#<hash> | advance --key=REQUEST#<hash> --to=<state> --reason=<reason> [--classification=<type>] [--evidence=<id>]";

/** Pure: argv -> Result<{command, options}>. */
export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = Object.fromEntries(rest.filter(x => x.startsWith("--") && x.includes("=")).map(x => {
    const cut = x.indexOf("=");
    return [x.slice(2, cut), x.slice(cut + 1)];
  }));
  if (!["queue","show","advance"].includes(command)) return {ok:false, error:"usage"};
  if (command === "queue") {
    const queue = options.queue ?? "pending";
    return QUEUES[queue] ? {ok:true, value:{command, queue:QUEUES[queue]}} : {ok:false, error:"usage"};
  }
  if (typeof options.key !== "string" || !KEY.test(options.key)) return {ok:false, error:"invalid_key"};
  if (command === "advance" && (!options.to || !options.reason)) return {ok:false, error:"usage"};
  return {ok:true, value:{command, key:options.key, to:options.to, reason:options.reason,
    classification:options.classification, evidence:options.evidence}};
}

const json = (text, fallback) => { try { return JSON.parse(text); } catch { return fallback; } };

/** Pure: DynamoDB item -> operator view (report body is shown ONLY by `show`). */
export const decodeRecord = item => ({
  reference:item.reference?.S, receivedAt:item.receivedAt?.S, kind:item.kind?.S,
  state:item.state?.S, revision:Number(item.revision?.N),
  screening:json(item.screening?.S || "{}", {}),
  report:json(item.report?.S || "{}", {}), history:json(item.history?.S || "[]", [])
});

/** Pure: where a record should sit after a transition (queue membership follows state). */
export const queueFor = state => TERMINAL.has(state) ? null : state === "quarantined" ? QUEUES.quarantined : QUEUES.pending;

/** Pure: current record + transition result -> UpdateItem input (optimistic concurrency). */
export function planUpdate({table, key, current, changed, reference, receivedAt}) {
  const queue = queueFor(changed.state);
  const values = {
    ":next":{S:changed.state}, ":before":{S:current.state},
    ":version":{N:String(changed.revision)}, ":expected":{N:String(current.revision)},
    ":history":{S:JSON.stringify(changed.history)},
    ...(queue ? {":queue":{S:queue}, ":sk":{S:receivedAt + "#" + reference}} : {})
  };
  return {
    TableName:table, Key:{pk:{S:key}},
    ConditionExpression:"attribute_exists(pk) AND revision = :expected AND #state = :before",
    UpdateExpression:"SET #state = :next, revision = :version, history = :history" +
      (queue ? ", reviewQueuePk = :queue, reviewQueueSk = :sk" : " REMOVE reviewQueuePk, reviewQueueSk"),
    ExpressionAttributeNames:{"#state":"state"}, ExpressionAttributeValues:values
  };
}

/**
 * Effects: db.send(command), commands {GetItemCommand, QueryCommand, UpdateItemCommand},
 * identity() -> Promise<arn>, now() -> ISO string, out(text), err(text).
 * Returns the process exit code. Never prints AWS error text (may carry ARNs/request data).
 */
export async function runTriage({argv, table, db, commands, identity, now, out, err}) {
  const args = parseArgs(argv);
  if (!table || !args.ok) {
    err((args.error === "invalid_key" ? "A valid private record key is required." : usage) + "\n");
    return 2;
  }
  const {command} = args.value;
  try {
    const actor = await identity();
    if (typeof actor !== "string" || !actor) { err("AWS identity is unavailable.\n"); return 3; }
    if (command === "queue") {
      const result = await db.send(new commands.QueryCommand({
        TableName:table, IndexName:"ReviewQueue",
        KeyConditionExpression:"#queue = :queue",
        ExpressionAttributeNames:{"#queue":"reviewQueuePk"},
        ExpressionAttributeValues:{":queue":{S:args.value.queue}},
        Limit:50
      }));
      // Expose only primary keys, not unreviewed confidential report bodies.
      const keys = (result.Items || []).map(x => x.pk?.S).filter(Boolean);
      out(JSON.stringify({queue:args.value.queue, pendingKeys:keys, partialPage:Boolean(result.LastEvaluatedKey)}, null, 2) + "\n");
      return 0;
    }
    const item = (await db.send(new commands.GetItemCommand({TableName:table, Key:{pk:{S:args.value.key}}, ConsistentRead:true}))).Item;
    if (!item || item.kind?.S !== "observation") { err("Observation not found or not reviewable.\n"); return 4; }
    const record = decodeRecord(item);
    if (command === "show") {
      // Authenticated operator command. Never run in public CI output. JSON encoding
      // escapes control characters, so stored text cannot drive the operator's terminal.
      out(JSON.stringify(record, null, 2) + "\n");
      return 0;
    }
    let changed;
    try {
      changed = transition({kind:"observation", state:record.state, revision:record.revision, history:record.history}, {
        to:args.value.to, expectedRevision:record.revision, actor, role:"triager", reason:args.value.reason,
        classification:args.value.classification, evidenceId:args.value.evidence, occurredAt:now()
      });
    } catch (error) {
      err("Transition refused: " + (error?.name === "TransitionError" ? error.message : "invalid transition") + "\n");
      return 5;
    }
    try {
      await db.send(new commands.UpdateItemCommand(planUpdate({table, key:args.value.key,
        current:record, changed, reference:record.reference, receivedAt:record.receivedAt})));
    } catch (error) {
      if (error?.name === "ConditionalCheckFailedException") { err("The record changed concurrently; reload and retry.\n"); return 6; }
      throw error;
    }
    out(JSON.stringify({reference:record.reference, state:changed.state, revision:changed.revision, actor}) + "\n");
    return 0;
  } catch {
    err("Triage operation failed (AWS unavailable or access denied).\n");
    return 7;
  }
}

const isMain = process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href;
if (isMain) {
  const table = process.env.REPORTS_TABLE_NAME;
  const argv = process.argv.slice(2);
  const pre = parseArgs(argv);
  if (!table || !pre.ok) {
    process.exitCode = await runTriage({argv, table, out:t => process.stdout.write(t), err:t => process.stderr.write(t)});
  } else {
    const {DynamoDBClient, GetItemCommand, QueryCommand, UpdateItemCommand} = await import("@aws-sdk/client-dynamodb");
    const {STSClient, GetCallerIdentityCommand} = await import("@aws-sdk/client-sts");
    const sts = new STSClient({});
    process.exitCode = await runTriage({
      argv, table, db:new DynamoDBClient({}), commands:{GetItemCommand, QueryCommand, UpdateItemCommand},
      identity:async () => (await sts.send(new GetCallerIdentityCommand({}))).Arn,
      now:() => new Date().toISOString(),
      out:t => process.stdout.write(t), err:t => process.stderr.write(t)
    });
  }
}
