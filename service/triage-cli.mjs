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
import {table as lifecycleTable} from "./triage.mjs";
import {evaluateTransition} from "./lifecycle.mjs";

// Strict domain path (DOM-001 item 7): commands carry an explicit provenance class, typed
// evidence [{kind, ref}] and declared fields. The legacy untyped evidenceId shape and the
// "unrecorded" provenance are NOT used here; evaluateTransition is called without
// allowUnrecordedProvenance, so a missing provenance is refused.
export const OPERATOR_PROVENANCE = "authenticated-human";
const FIELD_OPTIONS = Object.freeze(["classification","severity","priority","confidence","productId","owner","duplicateOf","supersededBy","workItemRef"]);
const EVIDENCE_REQUIRED_TARGETS = new Set(["reopened"]);

export const QUEUES = Object.freeze({pending:"QUEUE#pending", quarantined:"QUEUE#quarantined"});
const TERMINAL = new Set(["classified","rejected"]);
const KEY = /^REQUEST#[0-9a-f]{64}$/;
const usage = "Usage: REPORTS_TABLE_NAME=<private table> node service/triage-cli.mjs queue [--queue=pending|quarantined] | show --key=REQUEST#<hash> | advance --key=REQUEST#<hash> --to=<state> --reason=<reason> [--classification=<text>] [--severity=..] [--priority=..] [--confidence=..] [--productId=..] [--owner=..] [--evidence=<kind>:<ref>[,<kind>:<ref>...]]  (--evidence is required for --to=reopened)";

/** Pure: "kind:ref,kind:ref" -> Result<[{kind, ref}]>. Kinds are validated by the lifecycle table. */
export function parseEvidence(text) {
  if (text === undefined) return {ok:true, value:[]};
  const items = String(text).split(",").map(part => {
    const cut = part.indexOf(":");
    return cut > 0 ? {kind:part.slice(0, cut).trim(), ref:part.slice(cut + 1).trim()} : null;
  });
  return items.length && items.every(i => i && i.kind && i.ref) ? {ok:true, value:items} : {ok:false, error:"invalid_evidence"};
}

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
  if (command !== "advance") return {ok:true, value:{command, key:options.key}};
  if (!options.to || !options.reason) return {ok:false, error:"usage"};
  const evidence = parseEvidence(options.evidence);
  if (!evidence.ok) return {ok:false, error:"invalid_evidence"};
  if (EVIDENCE_REQUIRED_TARGETS.has(options.to) && evidence.value.length === 0) return {ok:false, error:"evidence_required"};
  const fields = Object.fromEntries(FIELD_OPTIONS.filter(f => options[f] !== undefined).map(f => [f, options[f]]));
  return {ok:true, value:{command, key:options.key, to:options.to, reason:options.reason, fields, evidence:evidence.value}};
}

/** Pure: parsed advance arguments + current record + actor + clock -> strict lifecycle command. */
export const buildCommand = ({args, record, actor, occurredAt}) => Object.freeze({
  to:args.to, expectedRevision:record.revision, actor, provenance:OPERATOR_PROVENANCE,
  role:"triager", reason:args.reason, fields:args.fields, evidence:args.evidence, occurredAt
});

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
    const messages = {
      invalid_key:"A valid private record key is required.",
      invalid_evidence:"Evidence must be <kind>:<ref>[,<kind>:<ref>...].",
      evidence_required:"Reopening requires --evidence=<kind>:<ref> (new-occurrence or triage-correction)."
    };
    err((messages[args.error] ?? usage) + "\n");
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
    const evaluated = evaluateTransition(lifecycleTable,
      {kind:"observation", state:record.state, revision:record.revision, history:record.history},
      buildCommand({args:args.value, record, actor, occurredAt:now()}));
    if (!evaluated.ok) {
      err("Transition refused (" + evaluated.error.code + "): " + evaluated.error.message + "\n");
      return 5;
    }
    const changed = evaluated.value.record;
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
