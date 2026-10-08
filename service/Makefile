# SAM makefile build for IntakeFunction (H-04). Copies ONLY the public intake modules into
# the Lambda artifact. Operator tooling (triage-cli.mjs, triage.mjs, lifecycle.mjs,
# domain-records.mjs, product-registry.mjs) is deliberately excluded.
# tests/intake-package.test.mjs fails if this list and the handler's import graph diverge.
PUBLIC_MODULES = aws-handler.mjs http.mjs intake.mjs errors.mjs limits.mjs redaction.mjs report-domain.mjs package.json
PUBLIC_ADAPTERS = adapters/dynamodb-store.mjs adapters/turnstile-challenge.mjs adapters/safe-log.mjs

build-IntakeFunction:
	mkdir -p "$(ARTIFACTS_DIR)/adapters"
	cp $(PUBLIC_MODULES) "$(ARTIFACTS_DIR)/"
	cp $(PUBLIC_ADAPTERS) "$(ARTIFACTS_DIR)/adapters/"
