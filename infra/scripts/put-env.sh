#!/usr/bin/env bash
# Upload every KEY=value line of a local env file to SSM Parameter Store as
# SecureString /hark/prod/<KEY> (overwriting). Values are never printed.
#   AWS_PROFILE=inbound infra/scripts/put-env.sh path/to/.env.production
# Format: one KEY=value per line; blank lines, # comments and `export ` are fine;
# a value may be wrapped in matching single or double quotes (they are stripped,
# nothing inside is unescaped). No inline comments, no multi-line values: write
# PEM keys with literal \n, which the app accepts. Empty values are skipped
# (SSM cannot store them); delete a parameter with `aws ssm delete-parameter`.
set -euo pipefail

env_file=${1:?usage: put-env.sh <env-file>}
region=${AWS_REGION:-us-east-1}
prefix=/hark/prod

umask 077
value_file=$(mktemp)
trap 'rm -f "$value_file"' EXIT

count=0
line_no=0
while IFS= read -r line || [[ -n "$line" ]]; do
  line_no=$((line_no + 1))
  line=${line%$'\r'}
  [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
  line=${line#export }
  if [[ ! "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
    echo "line ${line_no}: not KEY=value, refusing to continue" >&2
    exit 1
  fi
  key=${BASH_REMATCH[1]}
  value=${BASH_REMATCH[2]}

  if [[ "$value" =~ ^\"(.*)\"$ || "$value" =~ ^\'(.*)\'$ ]]; then
    value=${BASH_REMATCH[1]}
  elif [[ "$value" == \"* || "$value" == \'* ]]; then
    echo "${key}: unterminated quote (multi-line values are not supported)" >&2
    exit 1
  fi

  case "$key" in
    NODE_ENV | PORT | DATABASE_URL)
      echo "skip ${key} (set by compose.yaml)"
      continue
      ;;
  esac
  if [[ -z "$value" ]]; then
    echo "skip ${key} (empty)"
    continue
  fi
  if [[ "$value" == *\'* ]]; then
    echo "${key}: values may not contain single quotes" >&2
    exit 1
  fi

  # Pass the value through a file so it never appears in the process list.
  printf '%s' "$value" >"$value_file"
  aws ssm put-parameter --region "$region" --name "${prefix}/${key}" --type SecureString \
    --overwrite --value "file://${value_file}" --no-cli-pager >/dev/null
  echo "put ${prefix}/${key}"
  count=$((count + 1))
done <"$env_file"

echo "Uploaded ${count} parameters to ${prefix} in ${region}."
for required in APP_URL BETTER_AUTH_SECRET CLOUDFLARE_TUNNEL_TOKEN; do
  if ! grep -Eq "^(export )?${required}=.+" "$env_file"; then
    echo "warning: ${required} is not in ${env_file}; deploy.sh requires it in SSM" >&2
  fi
done
