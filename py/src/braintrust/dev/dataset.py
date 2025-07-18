from braintrust.cli.eval.models import (
    DatasetId,
    ProjectAndDataset,
    RunEvalData,
)
from braintrust.dev.errors import DatasetNotFoundError
from braintrust.logger import BraintrustState, init_dataset


def get_dataset(state: BraintrustState, data: RunEvalData):
    if isinstance(data, ProjectAndDataset):
        return init_dataset(
            state=state, project=data.project_name, name=data.dataset_name, _internal_btql=data._internal_btql
        )  # type: ignore[reportPrivateUsage]

    if isinstance(data, DatasetId):
        dataset_info = get_dataset_by_id(state, data.dataset_id)
        return init_dataset(
            state=state,
            project_id=dataset_info["projectId"],
            name=dataset_info["dataset"],
            _internal_btql=data._internal_btql,  # type: ignore[reportPrivateUsage]
        )

    return data.data


def get_dataset_by_id(state: BraintrustState, dataset_id: str):
    dataset = state.app_conn().post_json("api/dataset/get", {"id": dataset_id})

    if not dataset:
        raise DatasetNotFoundError

    return {
        "projectId": dataset[0]["project_id"],
        "dataset": dataset[0]["name"],
    }
