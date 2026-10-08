// Structural review of infra/aws/template.yaml parsed with a CloudFormation-tag-aware YAML
// schema. This is NOT `sam validate` (SAM CLI is not installed here and AWS is unreachable);
// the p0-service.yml CI workflow runs `sam validate --lint` and `sam build`.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import yaml from "js-yaml";

const tags = ["Ref","Sub","GetAtt","Join","Select","Split","If","Equals","Not","And","Or","FindInMap","GetAZs","ImportValue","Base64","Cidr","Condition"];
const types = tags.flatMap(name => ["scalar","sequence","mapping"].map(kind =>
  new yaml.Type("!" + name, {kind, construct:data => ({["Fn::" + name]:data})})));
const schema = yaml.DEFAULT_SCHEMA.extend(types);
const template = yaml.load(readFileSync(new URL("../../infra/aws/template.yaml", import.meta.url), "utf8"), {schema});
const R = template.Resources;

test("Y-01 template parses and declares only the expected resources", () => {
  assert.equal(template.Transform, "AWS::Serverless-2016-10-31");
  assert.deepEqual(Object.keys(R).sort(), ["ApiAccessLogGroup", "IntakeApi", "IntakeFunction", "IntakeFunctionLogGroup", "ReportsTable"]);
});

test("Y-02 table: retained, PITR, encrypted, deletion-protected, private queue index keys-only", () => {
  const t = R.ReportsTable;
  assert.equal(t.DeletionPolicy, "Retain");
  assert.equal(t.UpdateReplacePolicy, "Retain");
  assert.equal(t.Properties.PointInTimeRecoverySpecification.PointInTimeRecoveryEnabled, true);
  assert.equal(t.Properties.SSESpecification.SSEEnabled, true);
  assert.deepEqual(t.Properties.DeletionProtectionEnabled, {"Fn::Ref":"TableDeletionProtection"});
  assert.equal(template.Parameters.TableDeletionProtection.Default, "true");
  // H-09: production cannot disable deletion protection or widen the origin (CFN Rules).
  const rule = template.Rules.ProductionUsesCanonicalOrigin;
  assert.deepEqual(rule.RuleCondition, {"Fn::Equals":[{"Fn::Ref":"EnvironmentName"}, "production"]});
  const asserts = rule.Assertions.map(a => JSON.stringify(a.Assert));
  for (const expected of [
    [{"Fn::Ref":"IntakeOrigin"}, "https://vitium.echelonfoundry.com"],
    [{"Fn::Ref":"ChallengeHostname"}, "vitium.echelonfoundry.com"],
    [{"Fn::Ref":"TableDeletionProtection"}, "true"]
  ]) assert.ok(asserts.includes(JSON.stringify({"Fn::Equals":expected})), JSON.stringify(expected));
  assert.equal(t.Properties.GlobalSecondaryIndexes[0].Projection.ProjectionType, "KEYS_ONLY");
});

test("Y-03 intake IAM: only PutItem/GetItem on the table + one secret; no Query/Scan/Update/Delete/wildcards", () => {
  const statements = R.IntakeFunction.Properties.Policies.flatMap(p => p.Statement);
  const actions = statements.flatMap(s => s.Action).sort();
  assert.deepEqual(actions, ["dynamodb:GetItem", "dynamodb:PutItem", "secretsmanager:GetSecretValue"]);
  for (const s of statements) {
    assert.equal(s.Effect, "Allow");
    assert.ok(!JSON.stringify(s.Resource).includes("*"), "no wildcard resources");
    assert.ok(!s.Action.some(a => a.includes("*")));
  }
  const get = statements.find(s => s.Action.includes("dynamodb:GetItem"));
  assert.deepEqual(get.Resource, {"Fn::GetAtt":"ReportsTable.Arn"}, "GetItem only on base table, never the index");
  assert.deepEqual([...get.Condition["ForAllValues:StringEquals"]["dynamodb:Attributes"]].sort(),
    ["disposition", "payloadHash", "pk", "receivedAt", "reference"], "replay read must not include report body");
  const secret = statements.find(s => s.Action.includes("secretsmanager:GetSecretValue"));
  assert.deepEqual(secret.Resource, {"Fn::Ref":"TurnstileSecretArn"});
});

test("Y-04 one public route: POST /api/v1/reports; no read routes; CORS pinned to canonical origin", () => {
  const events = Object.values(R.IntakeFunction.Properties.Events);
  assert.equal(events.length, 1);
  assert.equal(events[0].Properties.Method, "POST");
  assert.equal(events[0].Properties.Path, "/api/v1/reports");
  const api = R.IntakeApi.Properties;
  assert.deepEqual(api.DefinitionBody.paths, {});
  assert.deepEqual(api.CorsConfiguration.AllowOrigins, [{"Fn::Ref":"IntakeOrigin"}]);
  assert.equal(template.Parameters.IntakeOrigin.Default, "https://vitium.echelonfoundry.com");
  const originPattern = new RegExp(template.Parameters.IntakeOrigin.AllowedPattern);
  assert.ok(originPattern.test("https://staging.vitium.echelonfoundry.com"));
  for (const bad of ["*", "https://evil.example", "http://vitium.echelonfoundry.com", "https://vitium.echelonfoundry.com.evil.example", "https://a.b.vitium.echelonfoundry.com"]) {
    assert.ok(!originPattern.test(bad), bad);
  }
  assert.equal(template.Parameters.ChallengeHostname.Default, "vitium.echelonfoundry.com");
  assert.deepEqual(R.IntakeFunction.Properties.Environment.Variables.CHALLENGE_HOSTNAME, {"Fn::Ref":"ChallengeHostname"});
  assert.deepEqual(R.IntakeFunction.Properties.Environment.Variables.ENVIRONMENT_NAME, {"Fn::Ref":"EnvironmentName"});
  assert.equal(api.CorsConfiguration.AllowCredentials, false);
  assert.ok(!api.CorsConfiguration.AllowMethods.includes("GET"));
  assert.ok(api.DefaultRouteSettings.ThrottlingRateLimit > 0 && api.DefaultRouteSettings.ThrottlingBurstLimit > 0);
});

test("Y-05 secret is parameterised by ARN only; no inline secret values anywhere", () => {
  assert.match(template.Parameters.TurnstileSecretArn.AllowedPattern, /secretsmanager/);
  assert.equal(template.Parameters.TurnstileSecretArn.Default, undefined);
  const vars = R.IntakeFunction.Properties.Environment.Variables;
  assert.deepEqual(vars.TURNSTILE_SECRET_ARN, {"Fn::Ref":"TurnstileSecretArn"});
  assert.ok(!Object.keys(vars).some(k => /SECRET$|KEY$|TOKEN$|PASSWORD/.test(k) && k !== "TURNSTILE_SECRET_ARN"));
});

test("Y-06 log groups have retention, are stack-scoped, and the function writes to its declared group", () => {
  assert.equal(R.IntakeFunction.Properties.FunctionName, undefined, "fixed FunctionName collides across stacks");
  const group = R.IntakeFunctionLogGroup.Properties;
  assert.match(group.LogGroupName["Fn::Sub"], /\$\{AWS::StackName\}/);
  assert.ok(Number.isInteger(group.RetentionInDays) && group.RetentionInDays > 0);
  assert.deepEqual(R.IntakeFunction.Properties.LoggingConfig.LogGroup, {"Fn::Ref":"IntakeFunctionLogGroup"});
  const access = R.IntakeApi.Properties.AccessLogSettings;
  assert.deepEqual(access.DestinationArn, {"Fn::GetAtt":"ApiAccessLogGroup.Arn"});
  assert.doesNotMatch(access.Format, /sourceIp|userAgent|identity/, "no IP/UA in access logs until retention is decided");
  assert.ok(R.ApiAccessLogGroup.Properties.RetentionInDays > 0);
  assert.equal(template.Parameters.ReservedConcurrency.Default, 4);
  assert.deepEqual(R.IntakeFunction.Properties.ReservedConcurrentExecutions,
    {"Fn::If":["ReserveConcurrency", {"Fn::Ref":"ReservedConcurrency"}, {"Fn::Ref":"AWS::NoValue"}]});
  assert.equal(R.IntakeFunction.Metadata.BuildMethod, "makefile");
});
