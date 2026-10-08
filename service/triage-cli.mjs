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
import {evaluateTransition, recordInconclusive, reopenAndResume, promoteObservation} from "./lifecycle.mjs";

// VIT-LCY-002 promotion: a NEW defect identity linked to a classified observation. Defect ids
// must match the table's defectIdPattern (^DEF-[0-9]{4,}$, DOM-001 item 8); they are opaque
// and RANDOM (16 digits, about 53 bits), never a counter, so no shared sequence item exists.
// A collision is caught by attribute_not_exists(pk) on the defect Put and refused (exit 6).
export const DEFECT_ID_DIGITS = 16;
export const isGeneratedDefectId = id => new RegExp(lifecycleTable.promotion.defectIdPattern).test(id) && id.length === 4 + DEFECT_ID_DIGITS;

// Strict domain path (DOM-001 item 7): commands carry an explicit provenance class, typed
// evidence [{kind, ref}] and declared fields. The legacy untyped evidenceId shape and the
// "unrecorded" provenance are NOT used here; evaluateTransition is called without
// allowUnrecordedProvenance, so a missing provenance is refused.
export const OPERATOR_PROVENANCE = "authenticated-human";
// CLI flag -> lifecycle table field. Verification-cycle flags use operator-friendly names.
const FIELD_FLAGS = Object.freeze({
  classification:"classification", severity:"severity", priority:"priority", confidence:"confidence",
  productId:"productId", owner:"owner", duplicateOf:"duplicateOf", supersededBy:"supersededBy", workItemRef:"workItemRef",
  attempt:"attemptId", candidate:"candidateRevision", outcome:"verificationOutcome", author:"author",
  "work-item":"workItemId", "affected-release":"affectedRelease"
});
const ROLES = Object.freeze([...lifecycleTable.roles]);
const OUTCOME_TARGET = Object.freeze({passed:"resolved", failed:"in-progress"});

export const QUEUES = Object.freeze({pending:"QUEUE#pending", quarantined:"QUEUE#quarantined"});
const TERMINAL = new Set(["classified","rejected"]);
// Observations are keyed by the intake request hash; defects by their DEF- identity.
const KEY = /^(?:REQUEST#[0-9a-f]{64}|DEFECT#DEF-[0-9]{4,})$/;
const usage = [
  "Usage: REPORTS_TABLE_NAME=<private table> node service/triage-cli.mjs <command>",
  "  queue [--queue=pending|quarantined]",
  "  show --key=<KEY>                       KEY = REQUEST#<hash> | DEFECT#DEF-<n>",
  "  advance --key=<KEY> --to=<state> --reason=<text> [--role=triager|verifier|administrator]",
  "          [--classification= --severity= --priority= --confidence= --productId= --owner= --duplicateOf= --supersededBy= --workItemRef=]",
  "          [--attempt=<id> --candidate=<rev> --author=<actor> --work-item=<id> --affected-release=<rel>]",
  "          [--evidence=<kind>:<ref>[,<kind>:<ref>...]]",
  "  verify --key=DEFECT#.. --attempt=<id> --candidate=<rev> --outcome=passed|failed|inconclusive",
  "          --evidence=verification-run:<ref> --reason=<text> [--role=verifier|administrator]",
  "  promote --key=REQUEST#<hash> --reason=<text> [--role=triager|administrator]   (classified observation -> NEW defect)",
  "  reopen-and-resume --key=DEFECT#.. --evidence=new-occurrence:<ref> --reason=<text> [--affected-release=<rel>]",
  "          [--resume-to=in-progress|reproducing] [--attempt=<id> --work-item=<id>] [--resume-reason=<text>]",
  "Required fields, evidence and roles come from schemas/lifecycle/transitions.v1.json and are",
  "checked locally before any AWS call."
].join("\n");

/**
 * Pure: what the lifecycle table requires for EVERY edge into `to` (any source state), so a
 * command can be refused locally before the record (and its source state) is fetched.
 * The full per-edge check still runs in the domain decision after the record is read.
 */
export function localRequirements(to) {
  const rules = Object.values(lifecycleTable.machines).flatMap(m => m.transitions.filter(t => t.to === to));
  if (!rules.length) return null;
  const fields = rules[0].requiredFields.filter(f => rules.every(r => r.requiredFields.includes(f)));
  const evidence = rules.every(r => r.evidenceAnyOf.length) ? [...new Set(rules.flatMap(r => r.evidenceAnyOf))] : null;
  const roles = [...new Set(rules.flatMap(r => r.roles))];
  return Object.freeze({fields, evidence, roles});
}
const reverseFlag = Object.fromEntries(Object.entries(FIELD_FLAGS).map(([flag, field]) => [field, flag]));

/** Pure: check a target's table requirements against parsed fields/evidence/role. */
export function checkLocal({to, fields, evidence, role}) {
  const req = localRequirements(to);
  if (!req) return {ok:false, error:"unknown_target", detail:to};
  if (!req.roles.includes(role)) return {ok:false, error:"unauthorized_role", detail:req.roles.join("|")};
  const missing = req.fields.find(f => fields[f] === undefined);
  if (missing) return {ok:false, error:"missing_field", detail:"--" + reverseFlag[missing]};
  if (req.evidence && !evidence.some(e => req.evidence.includes(e.kind))) return {ok:false, error:"missing_evidence", detail:req.evidence.join("|")};
  return {ok:true};
}

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
  if (!["queue","show","advance","verify","reopen-and-resume","promote"].includes(command)) return {ok:false, error:"usage"};
  if (command === "queue") {
    const queue = options.queue ?? "pending";
    return QUEUES[queue] ? {ok:true, value:{command, queue:QUEUES[queue]}} : {ok:false, error:"usage"};
  }
  if (typeof options.key !== "string" || !KEY.test(options.key)) return {ok:false, error:"invalid_key"};
  if (command === "show") return {ok:true, value:{command, key:options.key}};
  if (!options.reason) return {ok:false, error:"usage"};
  const evidence = parseEvidence(options.evidence);
  if (!evidence.ok) return {ok:false, error:"invalid_evidence"};
  const fields = Object.fromEntries(Object.entries(FIELD_FLAGS).filter(([flag]) => options[flag] !== undefined).map(([flag, field]) => [field, options[flag]]));
  const isDefect = options.key.startsWith("DEFECT#");

  if (command === "promote") {
    if (isDefect) return {ok:false, error:"usage"};
    const role = options.role ?? "triager";
    const p = lifecycleTable.promotion;
    if (!p.roles.includes(role)) return {ok:false, error:"unauthorized_role", detail:p.roles.join("|")};
    // requiredFields = [defectId]: generated by the CLI's id effect, never operator-supplied.
    return {ok:true, value:{command, key:options.key, role, reason:options.reason}};
  }

  if (command === "verify") {
    if (!isDefect) return {ok:false, error:"usage"};
    const outcome = options.outcome;
    const role = options.role ?? "verifier";
    if (!["passed","failed","inconclusive"].includes(outcome)) return {ok:false, error:"invalid_outcome"};
    if (fields.attemptId === undefined) return {ok:false, error:"missing_field", detail:"--attempt"};
    if (fields.candidateRevision === undefined) return {ok:false, error:"missing_field", detail:"--candidate"};
    const ids = {attemptId:fields.attemptId, candidateRevision:fields.candidateRevision};
    if (outcome === "inconclusive") {
      const def = lifecycleTable.events["verification-inconclusive"];
      if (!def.roles.includes(role)) return {ok:false, error:"unauthorized_role", detail:def.roles.join("|")};
      if (!evidence.value.some(e => def.evidenceAnyOf.includes(e.kind))) return {ok:false, error:"missing_evidence", detail:def.evidenceAnyOf.join("|")};
      return {ok:true, value:{command, key:options.key, outcome, role, reason:options.reason, evidence:evidence.value, fields:ids}};
    }
    const to = OUTCOME_TARGET[outcome];
    const local = checkLocal({to, fields:ids, evidence:evidence.value, role});
    if (!local.ok) return local;
    return {ok:true, value:{command:"advance", key:options.key, to, role, reason:options.reason, evidence:evidence.value,
      fields:{...ids, verificationOutcome:outcome}}};
  }

  if (command === "reopen-and-resume") {
    if (!isDefect) return {ok:false, error:"usage"};
    const resumeTo = options["resume-to"] ?? "in-progress";
    if (!["in-progress","reproducing"].includes(resumeTo)) return {ok:false, error:"usage"};
    const role = options.role ?? "triager";
    const reopenFields = fields.affectedRelease === undefined ? {} : {affectedRelease:fields.affectedRelease};
    const first = checkLocal({to:"reopened", fields:reopenFields, evidence:evidence.value, role});
    if (!first.ok) return first;
    // The resume step is checked against the exact reopened -> <resumeTo> edge.
    const rule = lifecycleTable.machines.defect.transitions.find(t => t.from === "reopened" && t.to === resumeTo);
    if (!rule.roles.includes(role)) return {ok:false, error:"unauthorized_role", detail:rule.roles.join("|")};
    const allowed = [...rule.requiredFields, ...rule.optionalFields];
    const resumeFields = Object.fromEntries(allowed.filter(f => fields[f] !== undefined).map(f => [f, fields[f]]));
    const missing = rule.requiredFields.find(f => resumeFields[f] === undefined);
    if (missing) return {ok:false, error:"missing_field", detail:"--" + reverseFlag[missing]};
    return {ok:true, value:{command, key:options.key, role, reason:options.reason,
      resumeReason:options["resume-reason"] ?? options.reason, resumeTo,
      reopen:{fields:reopenFields, evidence:evidence.value}, resume:{fields:resumeFields}}};
  }

  if (!options.to) return {ok:false, error:"usage"};
  const role = options.role ?? "triager";
  if (!ROLES.includes(role)) return {ok:false, error:"unauthorized_role", detail:ROLES.join("|")};
  const local = checkLocal({to:options.to, fields, evidence:evidence.value, role});
  if (!local.ok) return local;
  return {ok:true, value:{command, key:options.key, to:options.to, role, reason:options.reason, fields, evidence:evidence.value}};
}

/** Pure: parsed advance arguments + current record + actor + clock -> strict lifecycle command. */
export const buildCommand = ({args, record, actor, occurredAt}) => Object.freeze({
  to:args.to, expectedRevision:record.revision, actor, provenance:OPERATOR_PROVENANCE,
  role:args.role ?? "triager", reason:args.reason, fields:args.fields, evidence:args.evidence, occurredAt
});

/**
 * Pure: promotion decision. Refuses an observation that was already promoted (one defect per
 * observation through this tool; merging/duplicates are a triage decision, VIT-OQ-014).
 */
export function decidePromotion({args, record, actor, occurredAt, defectId}) {
  if (record.promotedTo) return {ok:false, error:{code:"already_promoted", message:"This observation was already promoted to " + record.promotedTo + "."}};
  if (!isGeneratedDefectId(defectId)) return {ok:false, error:{code:"invalid_defect_id", message:"Defect id effect returned an invalid id."}};
  const observation = {kind:"observation", state:record.state, revision:record.revision, history:record.history,
    ...(record.links ? {links:record.links} : {})};
  return promoteObservation(lifecycleTable, observation, {actor, provenance:OPERATOR_PROVENANCE, role:args.role,
    reason:args.reason, occurredAt, expectedRevision:record.revision, defectId});
}

/**
 * Pure: ONE TransactWriteItems request for a promotion. Both items commit or neither does:
 *  1. Update the observation: only if it still exists as an unpromoted observation in state
 *     `classified` at the revision we read; append the link event, record links + promotedTo.
 *     Its state and kind are NOT changed (the observation is never mutated into a defect).
 *  2. Put the new defect: only if that key does not exist (random-id collision guard).
 */
export function planPromotion({table, key, record, result, createdAt}) {
  const {observation, defect} = result;
  return {TransactItems:[
    {Update:{
      TableName:table, Key:{pk:{S:key}},
      ConditionExpression:"attribute_exists(pk) AND #kind = :obs AND #state = :classified AND revision = :expected AND attribute_not_exists(promotedTo)",
      UpdateExpression:"SET revision = :version, history = :history, links = :links, promotedTo = :defect",
      ExpressionAttributeNames:{"#kind":"kind", "#state":"state"},
      ExpressionAttributeValues:{":obs":{S:"observation"}, ":classified":{S:lifecycleTable.promotion.fromState},
        ":expected":{N:String(record.revision)}, ":version":{N:String(observation.revision)},
        ":history":{S:JSON.stringify(observation.history)}, ":links":{S:JSON.stringify(observation.links)},
        ":defect":{S:defect.id}}
    }},
    {Put:{
      TableName:table,
      Item:{pk:{S:"DEFECT#" + defect.id}, id:{S:defect.id}, kind:{S:"defect"}, state:{S:defect.state},
        revision:{N:String(defect.revision)}, history:{S:JSON.stringify(defect.history)},
        observationKeys:{S:JSON.stringify([key])}, createdAt:{S:createdAt}},
      ConditionExpression:"attribute_not_exists(pk)"
    }}
  ]};
}

/** Pure: the domain decision for one CLI command against the current record (no I/O). */
export function decide({args, record, actor, occurredAt}) {
  const current = {kind:record.kind, ...(record.id ? {id:record.id} : {}), state:record.state, revision:record.revision, history:record.history};
  const base = {actor, provenance:OPERATOR_PROVENANCE, role:args.role ?? "triager", occurredAt};
  // VF-027: provenance comes from this authenticated boundary (IAM identity), passed as the
  // lifecycle's trusted context rather than read from the command body.
  const trusted = {context:{provenance:OPERATOR_PROVENANCE}};
  if (args.command === "verify") {
    const r = recordInconclusive(lifecycleTable, current, {...base, expectedRevision:record.revision,
      reason:args.reason, fields:args.fields, evidence:args.evidence}, trusted);
    return r.ok ? {ok:true, value:{record:r.value.record, events:[r.value.event]}} : r;
  }
  if (args.command === "reopen-and-resume") {
    const r = reopenAndResume(lifecycleTable, current,
      {...base, to:"reopened", expectedRevision:record.revision, reason:args.reason, fields:args.reopen.fields, evidence:args.reopen.evidence},
      {...base, to:args.resumeTo, reason:args.resumeReason, fields:args.resume.fields, evidence:[]}, trusted);
    return r.ok ? {ok:true, value:{record:r.value.record, events:r.value.events}} : r;
  }
  const r = evaluateTransition(lifecycleTable, current, buildCommand({args, record, actor, occurredAt}), trusted);
  return r.ok ? {ok:true, value:{record:r.value.record, events:[r.value.event]}} : r;
}

const json = (text, fallback) => { try { return JSON.parse(text); } catch { return fallback; } };

/** Pure: DynamoDB item -> operator view (report body is shown ONLY by `show`). */
export const decodeRecord = item => ({
  id:item.id?.S, reference:item.reference?.S, receivedAt:item.receivedAt?.S, kind:item.kind?.S,
  ...(item.promotedTo?.S ? {promotedTo:item.promotedTo.S} : {}),
  ...(item.links?.S ? {links:json(item.links.S, undefined)} : {}),
  ...(item.observationKeys?.S ? {observationKeys:json(item.observationKeys.S, [])} : {}),
  state:item.state?.S, revision:Number(item.revision?.N),
  screening:json(item.screening?.S || "{}", {}),
  report:json(item.report?.S || "{}", {}), history:json(item.history?.S || "[]", [])
});

/** Pure: where a record should sit after a transition (queue membership follows state). */
export const queueFor = state => TERMINAL.has(state) ? null : state === "quarantined" ? QUEUES.quarantined : QUEUES.pending;

/** Pure: current record + transition result -> UpdateItem input (optimistic concurrency). */
export function planUpdate({table, key, current, changed, reference, receivedAt}) {
  // ONE conditional write per command, including the two-event reopen-and-resume composite:
  // the condition pins the revision and state read before the decision, so a concurrent
  // writer either wins outright or this write is refused, and no reader can ever observe the
  // intermediate "reopened" state (the item goes from revision n to n+2 in one write).
  if (current.kind === "defect") {
    return {
      TableName:table, Key:{pk:{S:key}},
      ConditionExpression:"attribute_exists(pk) AND #kind = :kind AND revision = :expected AND #state = :before",
      UpdateExpression:"SET #state = :next, revision = :version, history = :history",
      ExpressionAttributeNames:{"#state":"state", "#kind":"kind"},
      ExpressionAttributeValues:{":kind":{S:"defect"}, ":next":{S:changed.state}, ":before":{S:current.state},
        ":version":{N:String(changed.revision)}, ":expected":{N:String(current.revision)}, ":history":{S:JSON.stringify(changed.history)}}
    };
  }
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
export async function runTriage({argv, table, db, commands, identity, now, out, err, newDefectId}) {
  const args = parseArgs(argv);
  if (!table || !args.ok) {
    const messages = {
      invalid_key:"A valid private record key is required (REQUEST#<hash> or DEFECT#DEF-<n>).",
      invalid_evidence:"Evidence must be <kind>:<ref>[,<kind>:<ref>...].",
      invalid_outcome:"--outcome must be passed, failed or inconclusive.",
      unknown_target:"Unknown target state" + (args.detail ? ": " + args.detail : "") + ".",
      unauthorized_role:"This step requires --role=" + (args.detail ?? "") + ".",
      missing_field:"Missing required " + (args.detail ?? "field") + " for this step (lifecycle table).",
      missing_evidence:"Missing required --evidence of kind " + (args.detail ?? "") + " for this step (lifecycle table)."
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
    const expectedKind = args.value.key.startsWith("DEFECT#") ? "defect" : "observation";
    if (!item || item.kind?.S !== expectedKind) { err("Record not found or not reviewable.\n"); return 4; }
    const record = decodeRecord(item);
    if (command === "show") {
      // Authenticated operator command. Never run in public CI output. JSON encoding
      // escapes control characters, so stored text cannot drive the operator's terminal.
      out(JSON.stringify(record, null, 2) + "\n");
      return 0;
    }
    if (command === "promote") {
      const occurredAt = now();
      const promoted = decidePromotion({args:args.value, record, actor, occurredAt, defectId:newDefectId()});
      if (!promoted.ok) { err("Promotion refused (" + promoted.error.code + "): " + promoted.error.message + "\n"); return 5; }
      try {
        await db.send(new commands.TransactWriteItemsCommand(planPromotion({table, key:args.value.key, record,
          result:promoted.value, createdAt:occurredAt})));
      } catch (error) {
        if (["TransactionCanceledException", "ConditionalCheckFailedException"].includes(error?.name)) {
          err("Promotion not applied: the observation changed, was already promoted, or the id collided; reload and retry.\n");
          return 6;
        }
        throw error;
      }
      out(JSON.stringify({observation:args.value.key, defect:"DEFECT#" + promoted.value.defect.id, state:promoted.value.defect.state, actor}) + "\n");
      return 0;
    }
    const evaluated = decide({args:args.value, record, actor, occurredAt:now()});
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
    out(JSON.stringify({reference:record.reference ?? record.id, state:changed.state, revision:changed.revision,
      events:evaluated.value.events.map(e => e.type + ":" + (e.to ?? e.fields?.verificationOutcome ?? "")), actor}) + "\n");
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
    const {DynamoDBClient, GetItemCommand, QueryCommand, UpdateItemCommand, TransactWriteItemsCommand} = await import("@aws-sdk/client-dynamodb");
    const {randomInt} = await import("node:crypto");
    const {STSClient, GetCallerIdentityCommand} = await import("@aws-sdk/client-sts");
    const sts = new STSClient({});
    process.exitCode = await runTriage({
      argv, table, db:new DynamoDBClient({}), commands:{GetItemCommand, QueryCommand, UpdateItemCommand, TransactWriteItemsCommand},
      // Opaque random defect id: 16 digits, first digit non-zero (no leading-zero ambiguity).
      newDefectId:() => "DEF-" + String(randomInt(1, 10)) + Array.from({length:DEFECT_ID_DIGITS - 1}, () => randomInt(0, 10)).join(""),
      identity:async () => (await sts.send(new GetCallerIdentityCommand({}))).Arn,
      now:() => new Date().toISOString(),
      out:t => process.stdout.write(t), err:t => process.stderr.write(t)
    });
  }
}
