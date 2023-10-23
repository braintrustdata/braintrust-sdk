from .types import *


class _LogThread:
    def log(args):
        pass


class ModelWrapper:
    def __init__(self, data):
        self.data = data

    def __getattr__(self, name: str) -> Any:
        return self.data[name]


def _populate_args(d, **kwargs):
    for k, v in kwargs.items():
        if v is not None:
            d[k] = v

    return d


class DatasetImpl(ModelWrapper):
    def __init__(self, args: DatasetConstructorArgs):
        self.finished = False

        self.project = args.project
        self.id = args.id
        self.name = args.name
        self.pinned_version = args.pinned_version
        this.logger = _LogThread()

    def insert(self, args: DatasetInsertArgs):
        self._check_not_finished()

        if args.metadata:
            if not isinstance(args.metadata, dict):
                raise ValueError("metadata must be a dictionary")
            for key in args.metadata.keys():
                if not isinstance(key, str):
                    raise ValueError("metadata keys must be strings")

        logArgs = _populate_args(
            {
                "id": args.id or str(uuid.uuid4()),
                "inputs": args.input,
                "output": args.output,
                "project_id": self.project.id,
                "dataset_id": self.id,
                "created": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            },
            metadata=metadata,
        )

        self._clear_cache()  # We may be able to optimize this
        self.new_records += 1
        self.logger.log(logArgs)
        return logArgs["id"]

    def _clear_cache(self):
        self._check_not_finished()
        self._fetched_data = None

    def _check_not_finished(self):
        if self.finished:
            raise RuntimeError("Cannot invoke method on finished dataset")
