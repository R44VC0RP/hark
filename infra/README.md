# Hark on AWS

Production runs on one `t4g.small` in us-east-1, defined by the CDK stack in
`lib/hark-stack.ts`. There are no inbound ports: a Cloudflare Tunnel connector
on the host carries `hark.ryan.ceo` to the app, and operators get a shell
through SSM Session Manager.

```
Cloudflare edge ── tunnel (outbound) ──> cloudflared ──> hark:8787 ──> /data/hark.sqlite
                                                                  └── litestream ──> S3 (backups)
GitHub Actions ── OIDC ──> ECR push, S3 bundle, SSM Run Command ──> /opt/hark/deploy.sh
```

| Piece | What it is |
| --- | --- |
| `lib/hark-stack.ts` | VPC (one public subnet, no NAT), egress-only security group, the instance, ECR `hark`, backups and deploy buckets, IAM roles, recover alarm, optional alerts and budget |
| `host/bootstrap.sh` | First-boot user data: Docker, pinned compose plugin, `dnf-automatic`, log rotation |
| `host/compose.yaml` | `hark`, `cloudflared` and `litestream` containers, all read-only with no capabilities |
| `host/deploy.sh` | Renders `.env` from SSM, pulls, restores a missing DB, starts, waits for healthy |
| `host/restore.sh` | Restores the DB from the Litestream replica |
| `scripts/put-env.sh` | Uploads a local env file to SSM as SecureString parameters |

## Cost

About **$18 per month**, on demand:

| Item | Monthly |
| --- | --- |
| `t4g.small` on demand | ~$12.30 |
| 20 GiB gp3 root volume | ~$1.60 |
| Public IPv4 address | ~$3.60 |
| S3, ECR, SSM Parameter Store, CloudWatch alarm | cents |

A 1-year no-upfront reserved instance (or Savings Plan) roughly halves the
compute line. SecureString parameters use the AWS-managed `aws/ssm` key, which
is free. NAT gateways, load balancers and Elastic IPs are deliberately absent.

## Configuration

Everything the app reads lives in SSM Parameter Store as SecureString
parameters under `/hark/prod/<NAME>`. `deploy.sh` renders them to
`/opt/hark/.env` (mode 600) on every deploy. `CLOUDFLARE_TUNNEL_TOKEN` goes only
to `/opt/hark/cloudflared.env` (as `TUNNEL_TOKEN`), so the app never sees it.

Required, or the deploy fails:

| Name | Value |
| --- | --- |
| `APP_URL` | `https://hark.ryan.ceo` |
| `BETTER_AUTH_SECRET` | the existing production secret (sessions break if it changes) |
| `CLOUDFLARE_TUNNEL_TOKEN` | the tunnel's connector token |

Required for correct production behaviour:

| Name | Value |
| --- | --- |
| `TRUSTED_CLIENT_IP_HEADER` | `cf-connecting-ip` (safe because the tunnel is the only way in) |
| `APNS_ENVIRONMENT` | `production` |

Optional, as in the root `compose.yaml`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`APPLE_SIGN_IN_SERVICE_ID`, `APPLE_SIGN_IN_BUNDLE_ID`, `APPLE_SIGN_IN_KEY_ID`,
`APPLE_SIGN_IN_PRIVATE_KEY`, `EXPO_ACCESS_TOKEN`, `APNS_KEY_ID`, `APPLE_TEAM_ID`,
`APNS_PRIVATE_KEY`, `APNS_BUNDLE_ID`, `AUTUMN_API_KEY`, `UNLIMITED_TEAM_OWNER_EMAILS`,
`SERVICE_RATE_LIMIT_PER_MINUTE`, `ACCOUNT_RATE_LIMIT_PER_MINUTE`,
`PRO_SERVICE_RATE_LIMIT_PER_MINUTE`, `PRO_ACCOUNT_RATE_LIMIT_PER_MINUTE`. Unset
ones take the app defaults. `NODE_ENV`, `PORT` and `DATABASE_URL` are set by
`host/compose.yaml`; `put-env.sh` skips them.

Values are single-line: write PEM keys with literal `\n` (the app converts
them), or base64. Values may not contain a single quote.

## One-time setup

1. Sign in to the personal account:
   `export AWS_PROFILE=inbound && aws sso login` (or however the profile
   authenticates), then check `aws sts get-caller-identity`.
2. From the repo root: `pnpm install`, then
   `pnpm --filter @hark/infra exec cdk bootstrap aws://<account-id>/us-east-1`.
3. Deploy the stack: `pnpm --filter @hark/infra run deploy`. Add
   `-- -c alertEmail=you@example.com` for the alarm email and the $30 budget, and
   `-c createGithubOidcProvider=false` if the account already has the GitHub OIDC
   provider. Note the outputs: `InstanceId`, `RepositoryUri`, `BackupsBucketName`,
   `DeployBucketName`, `GithubDeployRoleArn`.
4. Create the tunnel in Cloudflare Zero Trust (Networks → Tunnels → Create, type
   cloudflared). Copy its token. Do not add the public hostname yet (it would
   collide with the current DNS record); that is the cutover step below.
5. Upload the configuration: `AWS_PROFILE=inbound infra/scripts/put-env.sh <env-file>`,
   where the file holds the production values plus `CLOUDFLARE_TUNNEL_TOKEN=...`,
   `TRUSTED_CLIENT_IP_HEADER=cf-connecting-ip` and `APNS_ENVIRONMENT=production`.
6. In GitHub → Settings → Environments → `production` → Variables, add
   `AWS_DEPLOY_ROLE_ARN` (the `GithubDeployRoleArn` output) and `HARK_INSTANCE_ID`
   (the `InstanceId` output). The old `EXE_DEV_SSH_PRIVATE_KEY` and
   `EXE_DEV_KNOWN_HOSTS` secrets can be deleted after the cutover.
7. Migrate the database (next section), then run the **Production Update**
   workflow. Its last step checks `https://hark.ryan.ceo`, so it only passes
   after the cutover.

The instance takes a few minutes after `cdk deploy` to finish `bootstrap.sh`;
check with `sudo cat /var/log/cloud-init-output.log` in a session.

## Migrating from exe.dev

1. On the old box (`ssh raven-cobra.exe.xyz`, `cd /home/exedev/hark`), stop the app
   and write a consistent copy into the volume:

   ```sh
   docker compose stop hark
   docker compose run --rm --no-deps -T hark node -e "
     const Database = require('better-sqlite3');
     const db = new Database('/data/hark.sqlite');
     db.pragma('wal_checkpoint(TRUNCATE)');
     db.backup('/data/hark-migrate.sqlite').then(() => {
       console.log('integrity', db.pragma('integrity_check', { simple: true }));
       db.close();
     });
   " < /dev/null
   docker run --rm -v hark_hark-data:/data busybox cat /data/hark-migrate.sqlite > ~/hark-migrate.sqlite
   ```

   Leave it stopped: writes after this point would be lost.
2. Copy it to the laptop and into the deploy bucket:

   ```sh
   scp raven-cobra.exe.xyz:hark-migrate.sqlite .
   aws s3 cp hark-migrate.sqlite s3://<DeployBucketName>/migrate/hark.sqlite
   ```

3. Put it in the new host's volume before the first deploy
   (`aws ssm start-session --target <InstanceId>`):

   ```sh
   sudo docker volume create hark_hark-data
   sudo aws s3 cp --region us-east-1 s3://<DeployBucketName>/migrate/hark.sqlite \
     /var/lib/docker/volumes/hark_hark-data/_data/hark.sqlite
   sudo chown -R 1000:1000 /var/lib/docker/volumes/hark_hark-data/_data
   ```

   Compose warns once that it did not create this volume; that is harmless.
4. Run the **Production Update** workflow (or wait for step 7 above). `deploy.sh`
   finds the DB, so it does not restore over it; Litestream starts replicating it.
5. Cut over DNS: in Cloudflare DNS delete the `hark.ryan.ceo` CNAME to exe.dev,
   then in the tunnel add the public hostname `hark.ryan.ceo` → `http://hark:8787`
   (this creates the tunnel CNAME). Check `curl https://hark.ryan.ceo/api/health`.
6. Delete `s3://<DeployBucketName>/migrate/hark.sqlite`; it expires after 30 days
   regardless.

## Operations

- **Shell:** `aws ssm start-session --target <InstanceId>`; then
  `cd /opt/hark && sudo docker compose --env-file compose.env ps` (or `logs -f hark`).
- **Deploy:** run the **Production Update** workflow. It builds the arm64 image,
  pushes `:<sha>` and `:latest`, uploads `infra/host` as
  `s3://<DeployBucketName>/host/<sha>.tar.gz` and runs `deploy.sh` through SSM.
- **Rotate a secret:** `infra/scripts/put-env.sh <file>` (a file with just the
  changed keys is fine), then re-run the workflow. To remove a key:
  `aws ssm delete-parameter --name /hark/prod/<NAME>`.
- **Backups:** Litestream streams every change to
  `s3://<BackupsBucketName>/hark.sqlite`, with a daily snapshot and 72 hours of
  point-in-time history. Bucket versioning keeps overwritten objects 30 more days.
- **Restore:** in a session, `sudo /opt/hark/restore.sh --force` restores the
  latest state (the current files are moved aside, not deleted). Add
  `-timestamp 2026-10-22T10:00:00Z` for a point in time. On a replaced or new
  instance, just deploy: `deploy.sh` restores automatically when the DB is missing.
- **Updates:** `dnf-automatic` applies security updates daily. Amazon Linux 2023
  pins its repository release, so newer AL2023 releases arrive only with a new
  AMI; to move to one, `dnf upgrade --releasever=latest` in a session, or replace
  the instance (a new instance resolves the latest AMI at launch and restores
  from Litestream on its first deploy).
- **Bump compose, cloudflared or Litestream:** `COMPOSE_VERSION`/`COMPOSE_SHA256`
  in `host/bootstrap.sh` (applies to new instances only) and the image tags in
  `host/compose.yaml` (applies on the next deploy).

## Checks

`pnpm --filter @hark/infra synth` works offline:
`CDK_DEFAULT_ACCOUNT=123456789012 pnpm --filter @hark/infra synth`. It warns that
the instance `ImageId` (`resolve:ssm:...`) is not an `ami-*` id; EC2 accepts it,
and it keeps a new AMI release from replacing the instance on every deploy.
If `us-east-1a` cannot launch `t4g.small` for this account, pass
`-c availabilityZone=us-east-1b` (this replaces the VPC subnet and the instance).
