#!/usr/bin/env bash
# Explicitly approved maintenance of the offline development runner only.
set -euo pipefail
cd /opt/crew-dev-bridge

runner_recipe=/opt/crew-dev-bridge/bolt-source/runner-langgraph.Dockerfile
runner_new_tag=crew-dev-runner:bolt-langgraph-1.2.22
runner_backup_tag=crew-dev-runner:before-bolt-langgraph-1.2.22
test -f "$runner_recipe"
printf '%s  %s\n' '5d26204e0072bdfc777f8df0da768adcae1e7ae566f17bd38023b2ff5ad83404' "$runner_recipe" | sha256sum -c -
command -v flock >/dev/null

docker compose config --format json | python3 -c '
import json, sys
runner = json.load(sys.stdin)["services"]["runner"]
assert runner["image"] == "crew-dev-runner:local", "Unexpected runner image"
assert runner["network_mode"] == "none", "Runner must remain offline"
assert runner["read_only"] is True, "Runner filesystem must remain read-only"
'
runner_previous_id=$(docker image inspect --format '{{.Id}}' crew-dev-runner:local)
if docker image inspect "$runner_backup_tag" >/dev/null 2>&1; then
    runner_backup_id=$(docker image inspect --format '{{.Id}}' "$runner_backup_tag")
    test "$runner_backup_id" = "$runner_previous_id"
fi

# The trusted build installs only the pinned development dependency.
runner_build_dir=$(mktemp -d /tmp/bolt-langgraph-image.XXXXXX)
docker build --iidfile "$runner_build_dir/image-id" --tag "$runner_new_tag" - < "$runner_recipe"
runner_candidate_id=$(<"$runner_build_dir/image-id")
[[ "$runner_candidate_id" =~ ^sha256:[0-9a-f]{64}$ ]]
rm -- "$runner_build_dir/image-id"
rmdir -- "$runner_build_dir"
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
    --user 10002:10002 --entrypoint /opt/bolt-venv/bin/python "$runner_candidate_id" \
    -c "from langgraph.graph import StateGraph; from langgraph.types import Command, interrupt; from importlib.metadata import version; assert version('langgraph') == '1.2.22'; print('Pinned LangGraph imports passed as test user')"

# Hold the same advisory lock used by bridge enqueue operations during the swap.
test -f /opt/crew-dev-bridge/queue/workspace.lock
exec 9>>/opt/crew-dev-bridge/queue/workspace.lock
flock -w 30 9
python3 - <<'PY'
from pathlib import Path
queue = Path("/opt/crew-dev-bridge/queue")
pending = [p for p in (queue/"jobs").glob("*.json") if not (queue/"results"/p.name).is_file()]
if pending:
    raise SystemExit("Checks are queued or running; runner was not changed")
print("Development check queue is idle")
PY
runner_current_id=$(docker image inspect --format '{{.Id}}' crew-dev-runner:local)
test "$runner_current_id" = "$runner_previous_id"
docker image tag "$runner_previous_id" "$runner_backup_tag"

runner_switched=0
runner_finish() {
    runner_exit_status=$?
    if [ "$runner_exit_status" -ne 0 ] && [ "$runner_switched" -eq 1 ]; then
        if docker image tag "$runner_previous_id" crew-dev-runner:local \
            && docker compose up -d --no-deps --force-recreate runner; then
            printf '%s\n' 'Previous development runner image restored' >&2
        else
            printf '%s\n' 'Runner rollback failed; previous image is retained under the backup tag' >&2
        fi
    fi
    exit "$runner_exit_status"
}
trap runner_finish EXIT
runner_switched=1
docker image tag "$runner_candidate_id" crew-dev-runner:local
docker compose up -d --no-deps --force-recreate runner
docker compose exec -T --user 10002:10002 runner /opt/bolt-venv/bin/python \
    -c "from langgraph.graph import StateGraph; from langgraph.types import Command, interrupt; from importlib.metadata import version; assert version('langgraph') == '1.2.22'; print('Development runner LangGraph is ready')"
docker compose ps runner
trap - EXIT
printf '%s\n' "Previous image retained as $runner_backup_tag"
