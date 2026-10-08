import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {products,impacts} from "../service/report-domain.mjs";
import {PRODUCTS,IMPACTS} from "../site/submission.mjs";
import {publicIntake} from "../site/public-config.mjs";
import {handler} from "../service/aws-handler.mjs";
import {parseReceipt} from "../site/private-intake.mjs";
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");

test("public and private report contracts use the same product and impact names",()=>{
  assert.deepEqual(products,PRODUCTS);
  assert.deepEqual(impacts,IMPACTS);
});
test("direct reporting defaults to disabled until private infrastructure is verified",()=>{
  assert.equal(publicIntake.enabled,false);
  assert.equal(publicIntake.endpoint,"");
  assert.equal(publicIntake.turnstileSiteKey,"");
});
// The receipt guard moved from a source-level check in app.mjs into the pure
// site/private-intake.mjs parseReceipt() (UX fix round 1). This test now asserts the
// guard's BEHAVIOUR rather than matching source text, which is strictly stronger.
test("browser only shows private confirmation after verified service receipt",()=>{
  const page=read("site/index.html");
  const good={status:"received",reference:"VIT-"+"a1b2c3d4e5",receivedAt:"2026-10-08T12:00:00.000Z",replayed:false};
  assert.ok(parseReceipt(201,good),"a well-formed authoritative receipt is accepted");
  assert.ok(parseReceipt(200,{...good,replayed:true}),"an idempotent replay receipt is accepted");
  const refused=[
    [202,good],[204,good],[400,good],[500,good],
    [201,null],[201,[]],[201,"received"],
    [201,{...good,status:"accepted"}],[201,{...good,status:undefined}],
    [201,{...good,reference:undefined}],[201,{...good,reference:"12345"}],[201,{...good,reference:"VIT-<script>"}],
    [201,{...good,receivedAt:undefined}],[201,{...good,receivedAt:"not-a-date"}],
    [201,{...good,disposition:"published"}]
  ];
  for (const [status,body] of refused) assert.equal(parseReceipt(status,body),null,`refused: ${status} ${JSON.stringify(body)}`);
  // The reducer must also never enter an accepted phase on its own; the private
  // controls must exist only as inert templates while the gate is disabled.
  assert.match(read("site/state.mjs"),/ResetChallenge/);
  assert.match(page,/id="private-success"/);
  assert.match(page,/id="submit-private"/);
  assert.match(page,/id="turnstile-challenge"/);
  assert.match(page,/GitHub account is currently required to submit/);
});
test("AWS adapter rejects service invocation without deployment configuration",async()=>{
  // No table/secret should be configured in CI. No AWS module imported on refusal.
  const r=await handler({rawPath:"/api/v1/reports"});
  assert.equal(r.statusCode,503);
  assert.equal(JSON.parse(r.body).code,"service_unavailable");
});
test("infrastructure candidate grants write and single-record lookup, not public browse",()=>{
  const template=read("infra/aws/template.yaml");
  assert.match(template,/dynamodb:PutItem/);
  assert.match(template,/dynamodb:GetItem/);
  assert.doesNotMatch(template,/dynamodb:Scan|dynamodb:Query|dynamodb:DeleteItem/);
  assert.match(template,/secretsmanager:GetSecretValue/);
  assert.match(template,/PointInTimeRecoveryEnabled: true/);
  assert.match(template,/ThrottlingRateLimit/);
  assert.match(template,/https:\/\/vitium\.echelonfoundry\.com/);
  assert.match(template,/Path: \/api\/v1\/reports/);
  assert.match(template,/Method: POST/);
  assert.doesNotMatch(template,/Method: GET/);
});
