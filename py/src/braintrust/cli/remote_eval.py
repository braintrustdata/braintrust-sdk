import argparse
import os
import sys
from typing import Any, Dict, List, Optional

import braintrust
from braintrust.eval_registry import Registry
from braintrust.remote_eval import run_remote_eval_server


def build_parser(subparsers, parent_parser):
    parser = subparsers.add_parser(
        "remote-eval",
        parents=[parent_parser],
        help="Run a remote evaluation server",
        description="Start a remote evaluation server for running evaluations via API calls",
    )
    parser.add_argument(
        "eval_files",
        nargs="+",
        help="Python files containing evaluation definitions",
    )
    parser.add_argument(
        "--dev",
        action="store_true",
        help="Run in development mode",
    )
    parser.add_argument(
        "--dev-port",
        type=int,
        default=8080,
        help="Port to use in development mode (default: 8080)",
    )
    parser.set_defaults(func=remote_eval_cli)


def load_eval_files(eval_files: List[str]) -> Dict[str, List[str]]:
    """
    Load evaluation files and register them with the registry.

    Args:
        eval_files: List of evaluation file paths to load

    Returns:
        Dict mapping file paths to lists of evaluation names loaded from each file
    """
    results = {}
    for file_path in eval_files:
        try:
            # Resolve the file path
            abs_path = os.path.abspath(file_path)
            if not os.path.exists(abs_path):
                print(f"Warning: Evaluation file not found: {file_path}")
                continue

            print(f"Loading evaluations from {abs_path}")
            eval_names = Registry.load_from_file(abs_path)
            results[file_path] = list(eval_names)

            print(f"Loaded {len(eval_names)} evaluations: {', '.join(eval_names)}")
        except Exception as e:
            print(f"Error loading evaluation file {file_path}: {e}")

    return results


def remote_eval_cli(args):
    """Command to run a remote evaluation server."""
    # Load evaluation files
    loaded_evals = load_eval_files(args.eval_files)
    total_evals = sum(len(evals) for evals in loaded_evals.values())

    if total_evals == 0:
        print("Warning: No evaluations were loaded!")

    port = args.dev_port if args.dev else int(os.environ.get("PORT", "8080"))

    print(f"Starting remote evaluation server with {total_evals} evaluations on port {port}...")
    run_remote_eval_server(port)
