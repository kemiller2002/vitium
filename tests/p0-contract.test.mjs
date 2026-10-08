import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {products,impacts} from "../service/report-domain.mjs";
import {PRODUCTS,IMPACTS} from "../site/submission.mjs";
import {publicIntake} from "../site/public-config.mjs";
import {handler} from "../service/aws-handler.mjs";
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
test("browser only shows private confirmation after verified service receipt",()=>{
  const app=read("site/app.mjs");
  const page=read("site/index.html");
  assert.match(app,/if \(!body \|\| body.status!=="received"/);
  assert.match(app,/body.reference/);
  assert.match(page,/id="private-success"/);
  assert.match(page,/id="submit-private"/);
  assert.match(page,/id="turnstile-challenge"/);
  assert.match(page,/GitHub account is currently required to submit/);
  assert.match(app,/resetChallenge\(\)/);
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
