import logging
import textwrap
import time

from botocore.exceptions import ClientError

from ...aws import cloudformation

_logger = logging.getLogger("braintrust.install.api")

PARAMS = {
    "OrgName": "org_name",
    "ProvisionedConcurrency": "provisioned_concurrency",
    "EncryptDatabase": "encrypt_database",
    "PostgresAlternativeHost": "postgres_alternative_host",
    "APIHandlerMemorySize": "api_handler_memory_size",
    "WhitelistedOrigins": "whitelisted_origins",
    "PublicSubnet1AZ": "public_subnet_1_az",
    "PrivateSubnet1AZ": "private_subnet_1_az",
    "PrivateSubnet2AZ": "private_subnet_2_az",
    "PrivateSubnet3AZ": "private_subnet_3_az",
    "VPCCIDR": "vpc_cidr",
    "PublicSubnet1CIDR": "public_subnet_1_cidr",
    "PrivateSubnet1CIDR": "private_subnet_1_cidr",
    "PrivateSubnet2CIDR": "private_subnet_2_cidr",
    "PrivateSubnet3CIDR": "private_subnet_3_cidr",
    "ManagedPostgres": "managed_postgres",
    "ManagedClickhouse": "managed_clickhouse",
    "ClickhouseInstanceType": "clickhouse_instance_type",
    "PostgresVersion": "postgres_version",
}

REMOVED_PARAMS = ["ThirdAZIndex"]

DEFAULTS = {
    "DwType": "Postgres",
    "EncryptDatabase": "false",
    "ProvisionedConcurrency": 0,
    "APIHandlerMemorySize": 10240,
}

CAPABILITIES = ["CAPABILITY_IAM", "CAPABILITY_AUTO_EXPAND"]

LATEST_TEMPLATE = "https://braintrust-cf.s3.amazonaws.com/braintrust-latest.yaml"


def build_parser(subparsers, parents):
    parser = subparsers.add_parser("api", help="Install the Braintrust function API", parents=parents)

    parser.add_argument("name", help="Name of the CloudFormation stack to create or update")
    parser.add_argument(
        "--create",
        help="Create the stack if it does not exist",
        action="store_true",
        default=False,
    )
    parser.add_argument(
        "--vpc-connect",
        help="Connect to an existing VPC",
        action="store_true",
        default=False,
    )
    parser.add_argument(
        "--template",
        help="A specific CloudFormation template URL to use",
        default=None,
    )
    parser.add_argument(
        "--update-template",
        help="Update the CloudFormation to the latest version of the template",
        action="store_true",
        default=False,
    )

    # OrgName, ProvisionedConcurrency
    parser.add_argument("--org-name", help="The name of your organization", default=None)
    parser.add_argument(
        "--provisioned-concurrency",
        help="The amount of provisioned concurrency",
        default=None,
        type=int,
    )
    parser.add_argument(
        "--api-handler-memory-size",
        help="The amount of memory to allocate to the API handler",
        default=None,
        type=int,
    )
    parser.add_argument(
        "--whitelisted-origins",
        help="Comma-separated list of origins to whitelist",
        default=None,
    )
    parser.add_argument(
        "--public-subnet-1-az",
        help="The availability zone for the public subnet",
        default=None,
    )
    parser.add_argument(
        "--private-subnet-1-az",
        help="The availability zone for private subnet 1",
        default=None,
    )
    parser.add_argument(
        "--private-subnet-2-az",
        help="The availability zone for private subnet 2",
        default=None,
    )
    parser.add_argument(
        "--private-subnet-3-az",
        help="The availability zone for private subnet 3",
        default=None,
    )

    parser.add_argument(
        "--vpc-cidr",
        help="The CIDR for the VPC",
        default=None,
    )
    parser.add_argument(
        "--public-subnet-1-cidr",
        help="The CIDR for the public subnet",
        default=None,
    )
    parser.add_argument(
        "--private-subnet-1-cidr",
        help="The CIDR for private subnet 1",
        default=None,
    )
    parser.add_argument(
        "--private-subnet-2-cidr",
        help="The CIDR for private subnet 2",
        default=None,
    )
    parser.add_argument(
        "--private-subnet-3-cidr",
        help="The CIDR for private subnet 3",
        default=None,
    )

    # PostgresUrl
    parser.add_argument(
        "--managed-postgres",
        help="Spin up an RDS instance to use as the datastore",
        default=None,
        choices=[None, "true", "false"],
    )
    parser.add_argument(
        "--encrypt-database",
        help="Whether to encrypt the database",
        default="false",
        choices=[None, "true", "false"],
    )
    parser.add_argument(
        "--postgres-version",
        help="The version of the postgres instance",
        default=None,
    )
    parser.add_argument(
        "--postgres-alternative-host",
        help="Use an external host for postgres (but the same secrets)",
        default=None,
    )

    # Clickhouse
    parser.add_argument(
        "--managed-clickhouse",
        help="Spin up a Clickhouse Instance for faster analytics",
        default=None,
        choices=[None, "true", "false"],
    )
    parser.add_argument(
        "--clickhouse-instance-type",
        help="The instance type for the Clickhouse instance",
        default=None,
    )

    # ElastiCacheClusterId
    parser.add_argument("--elasticache-cluster-host", help="The ElastiCacheCluster host to use", default=None)
    parser.add_argument(
        "--elasticache-cluster-port", help="The ElastiCacheCluster host to use", default=None, type=int
    )

    # SecurityGroupId, SubnetIds
    parser.add_argument("--security-group-id", help="The security group ID to use", default=None)
    parser.add_argument("--subnet-ids", help="The subnet IDs to use", default=None)

    # Advancd use only
    parser.add_argument(
        "--postgres-url",
        help="[Advanced] The postgres URL to use (if you are connecting to another VPC)",
        default=None,
    )
    parser.add_argument("--clickhouse-pg-url", help="[Advanced] The clickhouse PG URL to use", default=None)
    parser.add_argument("--clickhouse-connect-url", help="[Advanced] The clickhouse connect URL to use", default=None)
    parser.add_argument(
        "--clickhouse-catchup-etl-arn", help="[Advanced] The clickhouse catchup ETL ARN to use", default=None
    )

    parser.set_defaults(func=main)


def main(args):
    template = args.template or LATEST_TEMPLATE

    status = None
    try:
        statuses = cloudformation.describe_stacks(StackName=args.name)["Stacks"]
        if len(statuses) == 1:
            status = statuses[0]
        _logger.debug(status)
    except ClientError as e:
        if "does not exist" not in str(e):
            raise

    vpc_connect = args.vpc_connect
    if status and not vpc_connect:
        vpc_connect = "SecurityGroupId" in set(x["ParameterKey"] for x in status["Parameters"])

    if vpc_connect:
        PARAMS["SecurityGroupId"] = "security_group_id"
        PARAMS["SubnetIds"] = "subnet_ids"
        PARAMS["ElastiCacheClusterHost"] = "elasticache_cluster_host"
        PARAMS["ElastiCacheClusterPort"] = "elasticache_cluster_port"
        PARAMS["PostgresUrl"] = "postgres_url"
        PARAMS["ClickhouseCatchupEtlArn"] = "clickhouse_catchup_etl_arn"
        PARAMS["ClickhouseConnectUrl"] = "clickhouse_connect_url"
        PARAMS["ClickhousePGUrl"] = "clickhouse_pg_url"

        if args.template is None:
            template = "https://braintrust-cf.s3.amazonaws.com/braintrust-latest-vpc.yaml"

    exists = status is not None
    if exists and args.create:
        _logger.error(
            textwrap.dedent(
                f"""\
            Stack with name {args.name} already exists. Either delete it in the AWS console or
            remove the --create flag."""
            )
        )
        exit(1)
    elif not exists and not args.create:
        _logger.error(
            textwrap.dedent(
                f"""\
            Stack with name {args.name} does not exist. Either create it manually by following
            https://www.braintrustdata.com/docs/getting-started/install or use the --create flag."""
            )
        )
        exit(1)

    if not exists:
        _logger.info(f"Creating stack with name {args.name}")

        params = [
            {
                "ParameterKey": k,
                "ParameterValue": str(v),
            }
            for (k, v) in [
                (param, args.__dict__[arg_name] or DEFAULTS.get(param, None)) for (param, arg_name) in PARAMS.items()
            ]
            if v is not None
        ]
        _logger.info(f"Using params: {params}")

        cloudformation.create_stack(
            StackName=args.name,
            TemplateURL=template,
            Parameters=params,
            Capabilities=CAPABILITIES,
        )

        for _ in range(120):
            status = cloudformation.describe_stacks(StackName=args.name)["Stacks"][0]
            if status["StackStatus"] != "CREATE_IN_PROGRESS":
                exists = True
                break
            _logger.info("Waiting for stack to be created...")
            time.sleep(5)
        else:
            _logger.error(
                textwrap.dedent(
                    """\
                Stack creation timed out. Please check the AWS console to see its status. You can also
                re-run this command without --create to continue the setup process once it's done."""
                )
            )
            exit(1)
        _logger.info(f"Stack with name {args.name} has been created with status: {status['StackStatus']}")
        exit(0)

    _logger.info(f"Stack with name {args.name} has status: {status['StackStatus']}")

    if not ("_COMPLETE" in status["StackStatus"] or "_FAILED" in status["StackStatus"]):
        _logger.info(f"Please re-run this command once the stack has finished creating or updating")
        exit(0)

    # Update params that have changed
    param_updates = {}
    for param, arg_name in PARAMS.items():
        if args.__dict__[arg_name] is not None:
            param_updates[param] = args.__dict__[arg_name]
    if len(param_updates) > 0 or args.update_template:
        template_kwargs = {"TemplateURL": template} if args.update_template else {"UsePreviousTemplate": True}
        _logger.info(
            f"Updating stack with name {args.name} with params: {param_updates} and template: {template_kwargs}"
        )

        stack = cloudformation.describe_stacks(StackName=args.name)["Stacks"][0]
        cloudformation.update_stack(
            StackName=args.name,
            Parameters=[
                {"ParameterKey": param, "ParameterValue": str(update)} for (param, update) in param_updates.items()
            ]
            + [
                {"ParameterKey": param["ParameterKey"], "UsePreviousValue": True}
                for param in stack["Parameters"]
                if param["ParameterKey"] not in param_updates and param["ParameterKey"] not in REMOVED_PARAMS
            ],
            Capabilities=CAPABILITIES,
            **template_kwargs,
        )

        for _ in range(120):
            status = cloudformation.describe_stacks(StackName=args.name)["Stacks"][0]
            if status["StackStatus"] != "UPDATE_IN_PROGRESS":
                exists = True
                break
            _logger.info("Waiting for stack to be updated...")
            time.sleep(5)
        else:
            _logger.error(
                textwrap.dedent(
                    """\
                Stack update timed out. Please check the AWS console to see its status. You can also
                re-run this command to try again."""
                )
            )
            exit(1)

        function_url = [x for x in status["Outputs"] if x["OutputKey"] == "EndpointURL"]
        if function_url:
            function_url = function_url[0]["OutputValue"]
        else:
            function_url = None
        _logger.info(f"Stack with name {args.name} has been updated with status: {status['StackStatus']}")
        _logger.info(f"Endpoint URL: {function_url}")
