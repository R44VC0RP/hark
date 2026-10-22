import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as cdk from "aws-cdk-lib";
import * as budgets from "aws-cdk-lib/aws-budgets";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import type { Construct } from "constructs";

const GITHUB_REPO = "R44VC0RP/hark";
const GITHUB_OIDC_URL = "https://token.actions.githubusercontent.com";
/** SSM Parameter Store path holding the app's .env (SecureString per key). */
const PARAMETER_PATH = "/hark/prod";

export interface HarkStackProps extends cdk.StackProps {
  /** Create the account's GitHub OIDC provider. An account can only have one. */
  readonly createGithubOidcProvider: boolean;
  /** Existing provider ARN, used when createGithubOidcProvider is false. */
  readonly githubOidcProviderArn?: string;
  /** Enables the SNS alarm topic and the monthly cost budget. */
  readonly alertEmail?: string;
  /** AZ for the single subnet; t4g is not offered in every us-east-1 AZ. */
  readonly availabilityZone: string;
}

export class HarkStack extends cdk.Stack {
  private readonly availabilityZone: string;

  constructor(scope: Construct, id: string, props: HarkStackProps) {
    super(scope, id, props);
    this.availabilityZone = props.availabilityZone;

    // One public subnet in one AZ and no NAT: the instance needs only outbound
    // traffic (Cloudflare Tunnel, ECR, S3, SSM), which its public IPv4 provides.
    const vpc = new ec2.Vpc(this, "Vpc", {
      ipAddresses: ec2.IpAddresses.cidr("10.80.0.0/24"),
      availabilityZones: [props.availabilityZone],
      natGateways: 0,
      subnetConfiguration: [{ name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 26 }],
      // Restricting the unused default SG needs a Lambda custom resource; nothing uses it.
      restrictDefaultSecurityGroup: false,
    });

    // No ingress at all: the only way in is the outbound Cloudflare Tunnel.
    const securityGroup = new ec2.SecurityGroup(this, "InstanceSecurityGroup", {
      vpc,
      description: "Hark host: egress only, ingress arrives through Cloudflare Tunnel",
      allowAllOutbound: true,
    });

    const repository = new ecr.Repository(this, "Repository", {
      repositoryName: "hark",
      imageScanOnPush: true,
      encryption: ecr.RepositoryEncryption.AES_256,
      lifecycleRules: [{ description: "Keep the last 10 images", maxImageCount: 10 }],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Bucket names are deterministic so CI can derive the deploy bucket from the account id.
    const backupsBucket = new s3.Bucket(this, "BackupsBucket", {
      bucketName: `hark-backups-${this.account}-${this.region}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      lifecycleRules: [
        {
          noncurrentVersionExpiration: cdk.Duration.days(30),
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const deployBucket = new s3.Bucket(this, "DeployBucket", {
      bucketName: `hark-deploy-${this.account}-${this.region}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(30),
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const parameterArn = (suffix: string) =>
      cdk.Stack.of(this).formatArn({
        service: "ssm",
        resource: "parameter",
        resourceName: `${PARAMETER_PATH.slice(1)}${suffix}`,
      });

    const instanceRole = new iam.Role(this, "InstanceRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      description: "Hark host: SSM access, ECR pull, its parameters and its buckets",
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore")],
    });
    instanceRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ecr:GetAuthorizationToken"],
        resources: ["*"],
      }),
    );
    instanceRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
        ],
        resources: [repository.repositoryArn],
      }),
    );
    instanceRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParametersByPath", "ssm:GetParameter", "ssm:GetParameters"],
        // GetParametersByPath is authorized against the path itself.
        resources: [parameterArn(""), parameterArn("/*")],
      }),
    );
    instanceRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject"],
        resources: [deployBucket.arnForObjects("*")],
      }),
    );
    instanceRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:ListBucket", "s3:GetBucketLocation"],
        resources: [backupsBucket.bucketArn],
      }),
    );
    instanceRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
        resources: [backupsBucket.arnForObjects("*")],
      }),
    );

    // bootstrap.sh is the single copy of the first-boot script; the stack only
    // prepends the values it needs.
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      `export LITESTREAM_BUCKET=${backupsBucket.bucketName}`,
      `export AWS_REGION=${this.region}`,
      readFileSync(join(__dirname, "../host/bootstrap.sh"), "utf8"),
    );

    const instance = new ec2.Instance(this, "Instance", {
      instanceName: "hark",
      vpc,
      availabilityZone: props.availabilityZone,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      associatePublicIpAddress: true,
      securityGroup,
      role: instanceRole,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.SMALL),
      // Latest AL2023 arm64 at the time of the lookup, cached as a concrete AMI id in
      // cdk.context.json. Without the cache the AMI would re-resolve on every deploy
      // and replace the instance (and its data volume) whenever AWS publishes a new
      // image. Refresh deliberately with `cdk context --reset`.
      machineImage: ec2.MachineImage.latestAmazonLinux2023({
        cpuType: ec2.AmazonLinuxCpuType.ARM_64,
        cachedInContext: true,
      }),
      blockDevices: [
        {
          deviceName: "/dev/xvda",
          volume: ec2.BlockDeviceVolume.ebs(20, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
            deleteOnTermination: true,
          }),
        },
      ],
      httpEndpoint: true,
      httpTokens: ec2.HttpTokens.REQUIRED,
      // 2 hops so the Litestream container can reach IMDS for the role's credentials.
      httpPutResponseHopLimit: 2,
      detailedMonitoring: false,
      userData,
    });

    const githubProvider = props.createGithubOidcProvider
      ? new iam.OidcProviderNative(this, "GithubOidcProvider", {
          url: GITHUB_OIDC_URL,
          clientIds: ["sts.amazonaws.com"],
        })
      : iam.OidcProviderNative.fromOidcProviderArn(
          this,
          "GithubOidcProvider",
          props.githubOidcProviderArn ??
            cdk.Stack.of(this).formatArn({
              service: "iam",
              region: "",
              resource: "oidc-provider",
              resourceName: "token.actions.githubusercontent.com",
            }),
        );

    const deployRole = new iam.Role(this, "GithubDeployRole", {
      roleName: "hark-github-deploy",
      description: "GitHub Actions production deploy for Hark",
      maxSessionDuration: cdk.Duration.hours(1),
      assumedBy: new iam.FederatedPrincipal(
        githubProvider.oidcProviderArn,
        {
          StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
            "token.actions.githubusercontent.com:sub": [
              `repo:${GITHUB_REPO}:environment:production`,
              `repo:${GITHUB_REPO}:ref:refs/heads/main`,
            ],
          },
        },
        "sts:AssumeRoleWithWebIdentity",
      ),
    });
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ecr:GetAuthorizationToken"],
        resources: ["*"],
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:CompleteLayerUpload",
          "ecr:GetDownloadUrlForLayer",
          "ecr:InitiateLayerUpload",
          "ecr:PutImage",
          "ecr:UploadLayerPart",
        ],
        resources: [repository.repositoryArn],
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:PutObject"],
        resources: [deployBucket.arnForObjects("host/*")],
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ssm:SendCommand"],
        resources: [
          cdk.Stack.of(this).formatArn({
            service: "ec2",
            resource: "instance",
            resourceName: instance.instanceId,
          }),
          "arn:aws:ssm:*:*:document/AWS-RunShellScript",
        ],
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        // None of these support resource-level permissions.
        actions: [
          "ssm:GetCommandInvocation",
          "ssm:ListCommandInvocations",
          "ec2:DescribeInstances",
        ],
        resources: ["*"],
      }),
    );

    // EC2 auto-recovery when the underlying host fails its status check.
    const systemCheckAlarm = new cloudwatch.Alarm(this, "SystemStatusCheckAlarm", {
      alarmDescription: "Hark host failed the EC2 system status check; recovering",
      metric: new cloudwatch.Metric({
        namespace: "AWS/EC2",
        metricName: "StatusCheckFailed_System",
        dimensionsMap: { InstanceId: instance.instanceId },
        statistic: "Maximum",
        period: cdk.Duration.minutes(1),
      }),
      threshold: 1,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.MISSING,
    });
    systemCheckAlarm.addAlarmAction(new cwActions.Ec2Action(cwActions.Ec2InstanceAction.RECOVER));

    if (props.alertEmail) {
      const topic = new sns.Topic(this, "AlertTopic", { displayName: "Hark alerts" });
      topic.addSubscription(new subscriptions.EmailSubscription(props.alertEmail));
      systemCheckAlarm.addAlarmAction(new cwActions.SnsAction(topic));

      new budgets.CfnBudget(this, "MonthlyBudget", {
        budget: {
          budgetName: "hark-monthly",
          budgetType: "COST",
          timeUnit: "MONTHLY",
          budgetLimit: { amount: 30, unit: "USD" },
        },
        notificationsWithSubscribers: [
          {
            notification: {
              notificationType: "ACTUAL",
              comparisonOperator: "GREATER_THAN",
              threshold: 80,
              thresholdType: "PERCENTAGE",
            },
            subscribers: [{ subscriptionType: "EMAIL", address: props.alertEmail }],
          },
        ],
      });
    }

    new cdk.CfnOutput(this, "InstanceId", { value: instance.instanceId });
    new cdk.CfnOutput(this, "RepositoryUri", { value: repository.repositoryUri });
    new cdk.CfnOutput(this, "BackupsBucketName", { value: backupsBucket.bucketName });
    new cdk.CfnOutput(this, "DeployBucketName", { value: deployBucket.bucketName });
    new cdk.CfnOutput(this, "GithubDeployRoleArn", { value: deployRole.roleArn });
  }

  /** The one AZ in use. Overriding this keeps synth free of an AZ lookup. */
  override get availabilityZones(): string[] {
    return [this.availabilityZone];
  }
}
