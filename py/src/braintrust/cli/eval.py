import asyncio
import fnmatch
import importlib
import logging
import os
import sys
from dataclasses import dataclass
from threading import Lock
from typing import List

from .. import login
from ..framework import (
    Evaluator,
    _evals,
    _set_lazy_load,
    bcolors,
    init_experiment,
    parse_filters,
    report_evaluator_result,
    run_evaluator,
)

INCLUDE = [
    "**/eval_*.py",
]
EXCLUDE = ["**/site-packages/**"]

_logger = logging.getLogger("braintrust.eval")


_import_lock = Lock()


@dataclass
class FileHandle:
    in_file: str

    def rebuild(self):
        in_file = os.path.abspath(self.in_file)

        with _import_lock:
            with _set_lazy_load(True):
                _evals.clear()

                try:
                    # https://stackoverflow.com/questions/67631/how-can-i-import-a-module-dynamically-given-the-full-path
                    spec = importlib.util.spec_from_file_location("eval", in_file)
                    module = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(module)

                    ret = _evals.copy()
                finally:
                    _evals.clear()

        return ret

    def watch(self):
        raise NotImplementedError


@dataclass
class EvaluatorOpts:
    verbose: bool
    no_send_logs: bool
    no_progress_bars: bool
    watch: bool
    filters: List[str]


@dataclass
class LoadedEvaluator:
    handle: FileHandle
    evaluator: Evaluator


def update_evaluators(evaluators, handles):
    for handle in handles:
        try:
            module_evals = handle.rebuild()
        except Exception as e:
            print(f"Failed to import {handle.in_file}: {e}", file=sys.stderr)
            continue

        for eval_name, evaluator in module_evals.items():
            if not isinstance(evaluator, Evaluator):
                continue

            if eval_name in evaluators:
                _logger.warning(
                    f"Evaluator {eval_name} already exists (in {evaluators[eval_name].handle.in_file} and {handle.in_file}). Will skip {eval_name} in {handle.in_file}."
                )
                continue

            evaluators[eval_name] = LoadedEvaluator(evaluator=evaluator, handle=handle)


async def run_evaluator_task(evaluator, position, opts: EvaluatorOpts):
    experiment = None
    if not opts.no_send_logs:
        experiment = init_experiment(evaluator.project_name, evaluator.metadata)

    try:
        return await run_evaluator(
            experiment, evaluator, position if not opts.no_progress_bars else None, opts.filters
        )
    finally:
        if experiment:
            experiment.close()


async def run_once(handles, evaluator_opts):
    evaluators = {}
    update_evaluators(evaluators, handles)

    eval_promises = [
        asyncio.create_task(run_evaluator_task(evaluator.evaluator, idx, evaluator_opts))
        for idx, evaluator in enumerate(evaluators.values())
    ]
    eval_results = [await p for p in eval_promises]

    for eval_name, (results, summary) in zip(evaluators.keys(), eval_results):
        report_evaluator_result(eval_name, results, summary, evaluator_opts.verbose)


def check_match(path_input, include_patterns, exclude_patterns):
    p = os.path.abspath(path_input)
    if include_patterns:
        include = False
        for pattern in include_patterns:
            if fnmatch.fnmatch(p, pattern):
                include = True
                break
        if not include:
            return False

    if exclude_patterns:
        exclude = False
        for pattern in exclude_patterns:
            if fnmatch.fnmatch(p, pattern):
                exclude = True
                break
        return not exclude

    return True


def collect_files(input_path):
    if os.path.isdir(input_path):
        for root, dirs, files in os.walk(input_path):
            for file in files:
                fname = os.path.join(root, file)
                if check_match(fname, INCLUDE, EXCLUDE):
                    yield fname
    else:
        if check_match(input_path, INCLUDE, EXCLUDE):
            yield input_path


def initialize_handles(files):
    input_paths = files if len(files) > 0 else ["."]

    fnames = set()
    for path in input_paths:
        for fname in collect_files(path):
            fnames.add(os.path.abspath(fname))

    return [FileHandle(in_file=fname) for fname in fnames]


def run(args):
    evaluator_opts = EvaluatorOpts(
        verbose=args.verbose,
        no_send_logs=args.no_send_logs,
        no_progress_bars=args.no_progress_bars,
        watch=args.watch,
        filters=parse_filters(args.filter) if args.filter else [],
    )

    handles = initialize_handles(args.files)

    if not evaluator_opts.no_send_logs:
        login(
            api_key=args.api_key,
            org_name=args.org_name,
            api_url=args.api_url,
        )

    if args.watch:
        print("Watch mode is not yet implemented", file=sys.stderr)
        exit(1)
    else:
        asyncio.run(run_once(handles, evaluator_opts))


def build_parser(subparsers, parent_parser):
    parser = subparsers.add_parser(
        "eval",
        help="Run evals locally.",
        parents=[parent_parser],
    )

    parser.add_argument(
        "--api-key",
        help="Specify a braintrust api key. If the parameter is not specified, the BRAINTRUST_API_KEY environment variable will be used.",
    )
    parser.add_argument(
        "--org-name",
        help="The name of a specific organization to connect to. This is useful if you belong to multiple.",
    )
    parser.add_argument(
        "--api-url",
        help="Specify a custom braintrust api url. Defaults to https://www.braintrustdata.com. This is only necessary if you are using an experimental version of Braintrust",
    )
    parser.add_argument(
        "--watch",
        action="store_true",
        help="Watch files for changes and rerun evals when changes are detected",
    )
    parser.add_argument(
        "--filter",
        help="Only run evaluators that match these filters. Each filter is a regular expression (https://docs.python.org/3/library/re.html). For example, --filter metadata.priority='^P0$' input.name='foo.*bar' will only run evaluators that have metadata.priority equal to 'P0' and input.name matching the regular expression 'foo.*bar'.",
        nargs="*",
    )
    parser.add_argument(
        "--no-send-logs",
        action="store_true",
        help="Do not send logs to Braintrust. Useful for testing evaluators without uploading results.",
    )
    parser.add_argument(
        "--no-progress-bars",
        action="store_true",
        help="Do not show progress bars when processing evaluators.",
    )
    parser.add_argument(
        "files",
        nargs="*",
        help="A list of files or directories to run. If no files are specified, the current directory is used.",
    )

    parser.set_defaults(func=run)
