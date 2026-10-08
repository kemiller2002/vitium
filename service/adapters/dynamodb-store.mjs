// DynamoDB adapter for the intake store port. The client and command constructors are
// injected, so the same code runs against AWS (Lambda runtime SDK) and against a local
// emulator in tests/integration. It never throws: every outcome is a Result value.
//
// Write protocol (VIT-API-004):
//   1. PutItem with ConditionExpression attribute_not_exists(pk)  -> created
//   2. On ConditionalCheckFailedException: strongly-consistent GetItem that projects ONLY
//      reference, payloadHash, receivedAt, disposition (never the report body). The intake
//      core compares payloadHash and either replays the original receipt or refuses.
// The IAM policy in infra/aws/template.yaml restricts GetItem to exactly these attributes.
import { ok, fail } from "../errors.mjs";

export const REPLAY_ATTRIBUTES = Object.freeze(["reference","payloadHash","receivedAt","disposition"]);
const THROTTLE = new Set(["ProvisionedThroughputExceededException","ThrottlingException","RequestLimitExceeded"]);

/** Pure: domain observation -> DynamoDB attribute map. */
export function encodeObservation(item) {
  return {
    pk:{S:item.pk}, reference:{S:item.reference}, payloadHash:{S:item.payloadHash},
    report:{S:JSON.stringify(item.report)}, screening:{S:JSON.stringify(item.screening ?? {})},
    source:{S:item.source}, visibility:{S:item.visibility}, kind:{S:item.kind},
    status:{S:item.status}, state:{S:item.state}, disposition:{S:item.disposition ?? item.state},
    revision:{N:String(item.revision)}, history:{S:JSON.stringify(item.history)},
    receivedAt:{S:item.receivedAt},
    reviewQueuePk:{S:item.reviewQueuePk}, reviewQueueSk:{S:item.receivedAt + "#" + item.reference}
  };
}

/** Pure: projected replay attributes -> plain object (missing values stay undefined). */
export const decodeReplay = attrs => Object.freeze({
  reference: attrs?.reference?.S, payloadHash: attrs?.payloadHash?.S,
  receivedAt: attrs?.receivedAt?.S, disposition: attrs?.disposition?.S
});

const classify = error => THROTTLE.has(error?.name) ? "throttled" : "unavailable";

/**
 * @param {{client:{send:Function}, tableName:string, commands:{PutItemCommand:Function, GetItemCommand:Function}}} deps
 */
export function makeDynamoStore({client, tableName, commands}) {
  if (!client?.send || !tableName || !commands?.PutItemCommand || !commands?.GetItemCommand) {
    throw new TypeError("DynamoDB store requires client, table name and commands.");
  }
  const {PutItemCommand, GetItemCommand} = commands;
  return Object.freeze({
    async putOnce(item) {
      try {
        await client.send(new PutItemCommand({
          TableName: tableName,
          Item: encodeObservation(item),
          ConditionExpression: "attribute_not_exists(pk)"
        }));
        return ok({created:true});
      } catch (error) {
        if (error?.name !== "ConditionalCheckFailedException") return fail(classify(error));
      }
      try {
        const found = await client.send(new GetItemCommand({
          TableName: tableName, Key:{pk:{S:item.pk}}, ConsistentRead: true,
          ProjectionExpression: REPLAY_ATTRIBUTES.map((_, i) => "#a" + i).join(","),
          ExpressionAttributeNames: Object.fromEntries(REPLAY_ATTRIBUTES.map((name, i) => ["#a" + i, name]))
        }));
        if (!found?.Item) return fail("unavailable");
        return ok({created:false, existing: decodeReplay(found.Item)});
      } catch (error) {
        return fail(classify(error));
      }
    }
  });
}
