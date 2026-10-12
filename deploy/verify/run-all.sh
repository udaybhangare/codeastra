#!/usr/bin/env bash
# Everything: unit (make test), security, integration S1/S2/S3/S6, chaos, S1 A/B x5. ~35 min.
source "$(dirname "$0")/lib.sh"
cd "$ROOT" && make -s test 2>&1 | grep -v "no test files" | tail -25
"$VERIFY_DIR/security.sh"; "$VERIFY_DIR/integration.sh" 1; "$VERIFY_DIR/chaos.sh"; "$VERIFY_DIR/repeat.sh" S1 5 1
