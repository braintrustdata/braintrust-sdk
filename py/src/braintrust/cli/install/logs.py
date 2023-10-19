import logging
from concurrent.futures import ThreadPoolExecutor
import time

from ...aws import cloudformation, logs

_logger = logging.getLogger("braintrust.install.logs")


def build_parser(subparsers, parents):
    parser = subparsers.add_parser("logs", help="Capture recent logs", parents=parents)
    parser.add_argument("name", help="Name of the CloudFormation stack to collect logs from")
    parser.add_argument("--service", help="Name of the service", default="api", choices=["api"])
    parser.add_argument("--hours", help="Number of seconds in the past to collect logs from", default=1, type=float)
    parser.set_defaults(func=main)


def main(args):
    stacks = cloudformation.describe_stacks(StackName=args.name)["Stacks"]
    if len(stacks) == 0:
        raise ValueError(f"Stack with name {args.name} does not exist")
    if len(stacks) > 1:
        raise ValueError(f"Multiple stacks with name {args.name} exist")
    stack = stacks[0]
    _logger.debug(stack)

    log_group_name = None
    if args.service == "api":
        lambda_function = [x for x in stack["Outputs"] if x["OutputKey"] == "APIHandlerName"]
        if len(lambda_function) != 1:
            raise ValueError(f"Expected 1 APIHandlerName, found {len(lambda_function)} ({lambda_function}))")
        log_group_name = f"/aws/lambda/{lambda_function[0]['OutputValue']}"
    else:
        raise ValueError(f"Unknown service {args.service}")

    start_time = int(time.time() - 3600 * args.hours) * 1000

    streams = [
        s
        for s in logs.describe_log_streams(
            logGroupName=log_group_name,
            descending=True,
        )["logStreams"]
        if s["firstEventTimestamp"] >= start_time
    ]
    streams.sort(key=lambda x: x["firstEventTimestamp"])

    _logger.debug(streams)

    def get_events(stream):
        return logs.get_log_events(
            logGroupName=log_group_name,
            logStreamName=stream["logStreamName"],
            startTime=start_time,
            startFromHead=True,
        )

    with ThreadPoolExecutor(8) as executor:
        events = executor.map(get_events, streams)

    last_ts = None
    for stream, log in zip(streams, events):
        print(f"---- {stream['logStreamName']}")
        for event in log["events"]:
            print(event)
