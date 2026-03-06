import {
  BraintrustState,
  initDataset,
  initExperiment,
  initLogger,
  login,
} from "braintrust";

async function main() {
  const state = await login();
  const serializedState = state.serialize();
  const bootstrappedState = BraintrustState.deserialize(serializedState);

  const logger = initLogger({
    projectName: "e2e-login-flow-project",
    state: bootstrappedState,
  });
  const dataset = initDataset({
    project: "e2e-login-flow-project",
    dataset: "e2e-login-flow-dataset",
    description: "Login flow dataset",
    metadata: {
      scope: "login-flow",
    },
    state: bootstrappedState,
  });
  const experiment = initExperiment("e2e-login-flow-project", {
    experiment: "e2e-login-flow-experiment",
    baseExperimentId: "experiment:login-flow-base",
    metadata: {
      scope: "login-flow",
    },
    state: bootstrappedState,
    tags: ["login-flow"],
  });

  console.log(
    JSON.stringify({
      ids: {
        datasetId: await dataset.id,
        experimentId: await experiment.id,
        projectId: await logger.id,
      },
      serializedState,
    }),
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
