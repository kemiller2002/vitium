// Operator-CLI caller classification (VF-035, mission section 7 gate 4, VIT-VER-011).
//
// Fail closed: an IAM caller is `authenticated-human` ONLY when its STS caller identity is an
// assumed-role session of a role on an explicit, operator-supplied allow-list. Everything
// else is `agent`: IAM users, root, federated users, other accounts or partitions, unlisted
// roles, malformed ARNs, and every caller when the allow-list is unset or empty. There are no
// default entries. Actor kind is never taken from a CLI flag or the command body.
//
// Why role ARNs and not session tags: sts:GetCallerIdentity does not return session tags, so
// the CLI cannot verify a tag such as vitium:actor-kind=human. (Tags can still be required
// in the operator IAM policy as defence in depth.) Recorded in SEC-001 "Operator actor kind".
//
// Assumed-role ARNs drop the role PATH: an iam role arn:aws:iam::A:role/ops/humans/Triager
// appears as arn:aws:sts::A:assumed-role/Triager/<session>. Role names are unique within an
// account regardless of path, so matching is on (partition, account, exact role name). Case
// is compared exactly (STS returns the stored spelling; a case-variant is treated as unlisted).
// Pure module: no environment, clock or network access.

const ok = value => Object.freeze({ok:true, value});
const fail = (code, message) => Object.freeze({ok:false, error:Object.freeze({code, message})});

export const HUMAN_ROLE_ENV = "VITIUM_HUMAN_OPERATOR_ROLE_ARNS";
export const HUMAN = "authenticated-human";
export const AGENT = "agent";

const PARTITION = "(aws|aws-cn|aws-us-gov)";
const ACCOUNT = "([0-9]{12})";
const ROLE_NAME = "([\\w+=,.@-]{1,64})";
const IAM_ROLE_ARN = new RegExp("^arn:" + PARTITION + ":iam::" + ACCOUNT + ":role/(?:[\\x21-\\x7e]*/)?" + ROLE_NAME + "$");
const ASSUMED_ROLE_ARN = new RegExp("^arn:" + PARTITION + ":sts::" + ACCOUNT + ":assumed-role/" + ROLE_NAME + "/([\\w+=,.@-]{2,64})$");

/** Pure: one IAM role ARN -> {partition, account, roleName}. */
export function parseRoleArn(text) {
  const m = typeof text === "string" ? IAM_ROLE_ARN.exec(text.trim()) : null;
  return m ? ok(Object.freeze({partition:m[1], account:m[2], roleName:m[3]})) : fail("invalid_role_arn", "Not an IAM role ARN.");
}

/** Pure: STS assumed-role session ARN -> {partition, account, roleName, session}. */
export function parseAssumedRoleArn(text) {
  const m = typeof text === "string" ? ASSUMED_ROLE_ARN.exec(text) : null;
  return m ? ok(Object.freeze({partition:m[1], account:m[2], roleName:m[3], session:m[4]})) : fail("not_assumed_role", "Not an assumed-role session.");
}

/**
 * Pure: the allow-list configuration text (comma-separated IAM role ARNs) -> Result<list>.
 * Unset/blank -> empty list (everyone is an agent). Any malformed entry fails the whole
 * configuration, so a typo cannot silently drop a human and cannot be read as "allow".
 */
export function parseHumanRoleAllowList(text) {
  if (text === undefined || text === null || String(text).trim() === "") return ok(Object.freeze([]));
  const entries = String(text).split(",").map(s => s.trim()).filter(Boolean);
  const parsed = entries.map(parseRoleArn);
  const bad = parsed.findIndex(r => !r.ok);
  if (bad >= 0) return fail("invalid_operator_config", HUMAN_ROLE_ENV + " entry " + (bad + 1) + " is not an IAM role ARN (arn:aws:iam::<account>:role/[path/]<name>).");
  return ok(Object.freeze(parsed.map(r => r.value)));
}

/** Pure: STS caller ARN + parsed allow-list -> trusted provenance (fail closed). */
export function classifyCaller(callerArn, allowList) {
  const session = parseAssumedRoleArn(callerArn);
  if (!session.ok || !Array.isArray(allowList)) return Object.freeze({provenance:AGENT, reason:"not-an-allow-listed-role-session"});
  const s = session.value;
  const match = allowList.find(r => r.partition === s.partition && r.account === s.account && r.roleName === s.roleName);
  return match
    ? Object.freeze({provenance:HUMAN, reason:"allow-listed-role", roleName:s.roleName, account:s.account})
    : Object.freeze({provenance:AGENT, reason:"role-not-allow-listed"});
}
