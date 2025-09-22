import os
import secrets
import uuid
from abc import ABC, abstractmethod

_id_generator = None



def get_trace_id():
    return _get_id_generator().get_trace_id()

def get_span_id():
    return _get_id_generator().get_span_id()


def _get_id_generator():
    global _id_generator
    if _id_generator is None:
        if os.getenv("BRAINTRUST_OTEL_COMPAT", "false").lower() == "true":
            _id_generator = OTELIDGenerator()
        else:
            _id_generator = UUIDGenerator()
    return _id_generator


def _reset():
    global _id_generator
    _id_generator = None



class IDGenerator(ABC):
    """Abstract base class for ID generators."""

    @abstractmethod
    def get_span_id(self):
        pass

    @abstractmethod
    def get_trace_id(self):
        pass


class UUIDGenerator(IDGenerator):
    """ID generator that uses UUID4 for both span and trace IDs."""

    def get_span_id(self):
        return str(uuid.uuid4())

    def get_trace_id(self):
        return str(uuid.uuid4())


class OTELIDGenerator(IDGenerator):
    """ ID generator that generates OpenTelemetry-compatible IDs. We use this to have ids that can
        seamlessly flow between Braintrust and OpenTelemetry.
    """

    def get_span_id(self):
        # Generate 8 random bytes and convert to hex
        return secrets.token_hex(8)

    def get_trace_id(self):
        # Generate 16 random bytes and convert to hex
        return secrets.token_hex(16)
