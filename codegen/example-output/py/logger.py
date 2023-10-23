from .types import *
from . import logger_impl as impl


class Dataset:
    """
    A dataset is a collection of records, such as model inputs and outputs, which represent data you can use to evaluate and fine-tune models. You can log production data to datasets, curate them with interesting examples, edit/delete records, and run evaluations against them.

    You should not create `Dataset` objects directly. Instead, use the `braintrust.init_dataset` method
    """

    def __init__(self, self, project: RegisteredProject, id: str, name: str, pinned_version: Optional[str] = None):
        self._impl = impl.DatasetImpl(
            DatasetConstructorArgs(project=project, id=id, name=name, pinned_version=pinned_version)
        )

    def insert(
        self, input: Any, output: Any, metadata: Optional[Dict[str, Any]] = None, id: Optional[str] = None
    ) -> str:
        """
        Insert a single record to the dataset. The record will be batched and uploaded behind the scenes. If you pass in an `id`, and a record with that `id` already exists, it will be overwritten (upsert).

        :param input: The argument that uniquely define an input case (an arbitrary, JSON serializable object).
        :param output: The output of your application, including post-processing (an arbitrary, JSON serializable object).
        :param metadata: (Optional) a dictionary with additional data about the test example, model outputs, or just about anything else that's relevant, that you can use to help find and analyze examples later. For example, you could log the `prompt`, example's `id`, or anything else that would be useful to slice/dice later. The values in `metadata` can be any JSON-serializable type, but its keys must be strings.
        :param id: (Optional) a unique identifier for the event. If you don't provide one, Braintrust will generate one for you.
        :returns: The `id` of the logged record.
        """
        return self._impl.insert(DatasetInsertArgs(input=input, output=output, metadata=metadata, id=id))
