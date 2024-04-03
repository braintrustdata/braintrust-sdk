import asyncio
import fnmatch
import importlib
import logging
import os
import sys
from dataclasses import dataclass, field
from threading import Lock
from typing import Dict, List, Optional, Union

from braintrust_core.util import eprint

from .. import login
from ..framework import (
    Evaluator,
    EvaluatorInstance,
    ReporterDef,
    _evals,
    _set_lazy_load,
    bcolors,
    default_reporter,
    init_experiment,
    parse_filters,
    report_evaluator_result,
    run_evaluator,
    set_thread_pool_max_workers,
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
    terminate_on_failure: bool
    watch: bool
    filters: List[str]
    jsonl: bool


@dataclass
class LoadedEvaluator:
    handle: FileHandle
    evaluator: Evaluator
    reporter: Optional[Union[ReporterDef, str]] = None


@dataclass
class EvaluatorState:
    evaluators: Dict[str, LoadedEvaluator] = field(default_factory=dict)
    reporters: Dict[str, ReporterDef] = field(default_factory=dict)


def update_evaluators(evaluators: EvaluatorState, handles, terminate_on_failure):
    for handle in handles:
        try:
            module_evals = handle.rebuild()
        except Exception as e:
            if terminate_on_failure:
                raise
            else:
                eprint(f"Failed to import {handle.in_file}: {e}")
                continue

        for eval_name, evaluator in module_evals.evaluators.items():
            if not isinstance(evaluator, EvaluatorInstance):
                continue

            if eval_name in evaluators.evaluators:
                _logger.warning(
                    f"Evaluator {eval_name} already exists (in {evaluators[eval_name].handle.in_file} and {handle.in_file}). Will skip {eval_name} in {handle.in_file}."
                )
                continue

            evaluators.evaluators[eval_name] = LoadedEvaluator(
                handle=handle, evaluator=evaluator.evaluator, reporter=evaluator.reporter
            )

        for reporter_name, reporter in module_evals.reporters.items():
            if not isinstance(reporter, ReporterDef):
                continue

            if reporter_name in evaluators.reporters:
                _logger.warning(
                    f"Reporter {reporter_name} already exists (in {evaluators.reporters[reporter_name].module} and {handle.in_file}). Will skip {reporter_name} in {handle.in_file}."
                )
                continue

            evaluators.reporters[reporter_name] = reporter


async def run_evaluator_task(evaluator, position, opts: EvaluatorOpts):
    experiment = None
    if not opts.no_send_logs:
        experiment = init_experiment(
            evaluator.project_name,
            evaluator.experiment_name,
            metadata=evaluator.metadata,
            is_public=evaluator.is_public,
        )

    try:
        return await run_evaluator(
            experiment, evaluator, position if not opts.no_progress_bars else None, opts.filters
        )
    finally:
        if experiment:
            experiment.flush()


def resolve_reporter(reporter: Optional[Union[ReporterDef, str]], reporters: Dict[str, ReporterDef]) -> ReporterDef:
    if isinstance(reporter, str):
        if reporter not in reporters:
            raise ValueError(f"Reporter {reporter} not found")
        return reporters[reporter]
    elif reporter:
        return reporter
    elif not reporters:
        return default_reporter
    elif len(reporters) == 1:
        return next(iter(reporters.values()))
    else:
        reporter_names = ", ".join(reporters.keys())
        raise ValueError(f"Multiple reporters found ({reporter_names}). Please specify a reporter explicitly.")


def add_report(eval_reports, reporter, report):
    if reporter.name not in eval_reports:
        eval_reports[reporter.name] = {"reporter": reporter, "results": []}
    eval_reports[reporter.name]["results"].append(report)


async def run_once(handles, evaluator_opts):
    objects = EvaluatorState()
    update_evaluators(objects, handles, terminate_on_failure=evaluator_opts.terminate_on_failure)

    eval_promises = [
        asyncio.create_task(run_evaluator_task(evaluator.evaluator, idx, evaluator_opts))
        for idx, evaluator in enumerate(objects.evaluators.values())
    ]
    eval_results = [await p for p in eval_promises]

    eval_reports = {}
    for evaluator, result in zip(objects.evaluators.values(), eval_results):
        resolved_reporter = resolve_reporter(evaluator.reporter, objects.reporters)
        report = resolved_reporter._call_report_eval(
            evaluator=evaluator.evaluator, result=result, verbose=evaluator_opts.verbose, jsonl=evaluator_opts.jsonl
        )
        add_report(eval_reports, resolved_reporter, report)

    all_success = True
    for report in eval_reports.values():
        reporter = report["reporter"]
        results = [await r for r in report["results"]]
        if not await reporter._call_report_run(results, verbose=evaluator_opts.verbose, jsonl=evaluator_opts.jsonl):
            _logger.error(f"Reporter {reporter.name} failed")
            all_success = False

    return all_success


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
        if not check_match(input_path, INCLUDE, EXCLUDE):
            _logger.warning(
                f"Reading {input_path} because it was specified directly. Rename it to eval_*.py "
                + "to include it automatically when you specify a directory."
            )
        yield input_path


def initialize_handles(files):
    input_paths = files if len(files) > 0 else ["."]

    fnames = set()
    for path in input_paths:
        for fname in collect_files(path):
            fnames.add(os.path.abspath(fname))

    return [FileHandle(in_file=fname) for fname in fnames]


def run(args):
    if args.num_workers:
        set_thread_pool_max_workers(args.num_workers)

    evaluator_opts = EvaluatorOpts(
        verbose=args.verbose,
        no_send_logs=args.no_send_logs,
        no_progress_bars=args.no_progress_bars,
        terminate_on_failure=args.terminate_on_failure,
        watch=args.watch,
        filters=parse_filters(args.filter) if args.filter else [],
        jsonl=args.jsonl,
    )

    handles = initialize_handles(args.files)

    if not evaluator_opts.no_send_logs:
        login(
            api_key=args.api_key,
            org_name=args.org_name,
            app_url=args.app_url,
        )

    if args.watch:
        eprint("Watch mode is not yet implemented")
        exit(1)
    else:
        if not asyncio.run(run_once(handles, evaluator_opts)):
            sys.exit(1)


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
        "--app-url",
        help="Specify a custom braintrust app url. Defaults to https://www.braintrustdata.com. This is only necessary if you are using an experimental version of Braintrust",
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
        "--jsonl",
        help="Format score summaries as jsonl, i.e. one JSON-formatted line per summary.",
        action="store_true",
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
        "--terminate-on-failure",
        action="store_true",
        help="If provided, terminates on a failing eval, instead of the default (moving onto the next one).",
    )
    parser.add_argument(
        "--num-workers",
        type=int,
        help="Specify the number of concurrent worker threads to run evals over, if they are defined as synchronous functions. Async functions will be run in the single-threaded asyncio event loop. If not specified, defaults to the number of cores on the machine.",
    )
    parser.add_argument(
        "files",
        nargs="*",
        help="A list of files or directories to run. If no files are specified, the current directory is used.",
    )

    parser.set_defaults(func=run)
