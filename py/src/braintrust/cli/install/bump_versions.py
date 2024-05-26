import logging
import time
from concurrent.futures import ThreadPoolExecutor

from ...aws import LazyClient, cloudformation

_logger = logging.getLogger("braintrust.install.logs")


def build_parser(subparsers, parents):
    parser = subparsers.add_parser(
        "bump-versions", help="Bump the version of each serverless function", parents=parents
    )
    parser.add_argument("name", help="Name of the CloudFormation stack")
    parser.set_defaults(func=main)


def main(args):
    resources = cloudformation.describe_stack_resources(StackName=args.name)
    lambda_ = LazyClient("lambda")

    # Then, publish the API handler lambdas just to bump their environment variable values
    api_handler = [r for r in resources["StackResources"] if r["LogicalResourceId"] == "APIHandler"]
    api_handler_js = [r for r in resources["StackResources"] if r["LogicalResourceId"] == "APIHandlerJS"]

    if not api_handler or not api_handler_js:
        raise ValueError("No APIHandler or APIHandlerJS found in the stack.")

    api_handler = api_handler[0]
    api_handler_js = api_handler_js[0]

    # Publish a new version of the API handler and re-point the "live2" alias to it
    for resource, alias in [(api_handler, "live2"), (api_handler_js, "live")]:
        new_version = lambda_.publish_version(FunctionName=resource["PhysicalResourceId"])
        lambda_.update_alias(
            FunctionName=resource["PhysicalResourceId"],
            Name=alias,
            FunctionVersion=new_version["Version"],
        )
