from braintrust import NOOP_SPAN, current_logger, current_span, init_logger

from . import agent

if current_span() == NOOP_SPAN and current_logger() is None:
    init_logger(project="braintrust-adk-py-examples")
