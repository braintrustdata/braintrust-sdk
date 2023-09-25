import logging
import textwrap
import time

from botocore.exceptions import ClientError

from ...aws import cloudformation

_logger = logging.getLogger("braintrust.install.api")

PARAMS = {
    "OrgName": "org_name",
    "ProvisionedConcurrency": "provisioned_concurrency",
    "DwDatabase": "dw_database",
    "DwHost": "dw_host",
    "DwUsername": "dw_username",
    "DwPassword": "dw_password",
    "DwPort": "dw_port",
    "DwType": "dw_type",
    "ManagedKafka": "managed_kafka",
    "KafkaBroker": "kafka_broker",
    "KafkaTopic": "kafka_topic",
    "KafkaUsername": "kafka_username",
    "KafkaPassword": "kafka_password",
}

DEFAULTS = {
    "ManagedKafka": "true",
    "DwType": "Postgres",
    "ProvisionedConcurrency": 0,
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

    # DwHost, DwPort, DwPassword, DwPort, DwType, DwUsername
    parser.add_argument("--dw-database", help="The database of the data warehouse", default=None)
    parser.add_argument("--dw-host", help="The host of the data warehouse", default=None)
    parser.add_argument("--dw-username", help="The username of the data warehouse", default=None)
    parser.add_argument("--dw-password", help="The password of the data warehouse", default=None)
    parser.add_argument("--dw-port", help="The port of the data warehouse", default=None)
    parser.add_argument(
        "--dw-type",
        help="The type of the data warehouse",
        default=None,
        choices=[None, "Postgres", "Redshift", "Snowflake"],
    )

    # PostgresUrl
    parser.add_argument(
        "--managed-postgres",
        help="Spin up an RDS instance to use as the datastore",
        default=None,
        choices=[None, "true", "false"],
    )
    parser.add_argument(
        "--postgres-url", help="The postgres URL to use (if you are connecting to another VPC)", default=None
    )

    # ManagedKafka, KafkaBroker, KafkaTopic, KafkaUsername, KafkaPassword
    parser.add_argument(
        "--managed-kafka",
        help="Whether to include a managed Kafka (MSK)",
        default=None,
        choices=[None, "true", "false"],
    )
    parser.add_argument("--kafka-broker", help="The Kafka broker to use", default=None)
    parser.add_argument("--kafka-topic", help="The Kafka topic to use", default=None)
    parser.add_argument("--kafka-username", help="The Kafka username to use", default=None)
    parser.add_argument("--kafka-password", help="The Kafka password to use", default=None)

    # ElastiCacheClusterId
    parser.add_argument("--elasticache-cluster-host", help="The ElastiCacheCluster host to use", default=None)
    parser.add_argument(
        "--elasticache-cluster-port", help="The ElastiCacheCluster host to use", default=None, type=int
    )

    # SecurityGroupId, SubnetIds
    parser.add_argument("--security-group-id", help="The security group ID to use", default=None)
    parser.add_argument("--subnet-ids", help="The subnet IDs to use", default=None)

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
        cloudformation.create_stack(
            StackName=args.name,
            TemplateURL=template,
            Parameters=[
                {
                    "ParameterKey": param,
                    "ParameterValue": str(args.__dict__[arg_name] or DEFAULTS.get(param, "")),
                }
                for (param, arg_name) in PARAMS.items()
            ],
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
        cloudformation.update_stack(
            StackName=args.name,
            Parameters=[
                {"ParameterKey": param, "ParameterValue": str(update)} for (param, update) in param_updates.items()
            ]
            + [
                {"ParameterKey": param, "UsePreviousValue": True}
                for param in PARAMS.keys()
                if param not in param_updates
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
