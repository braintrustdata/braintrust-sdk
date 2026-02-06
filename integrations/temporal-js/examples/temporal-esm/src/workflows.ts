import {
  proxyActivities,
  sleep,
  workflowInfo,
  defineSignal,
  setHandler,
  log,
} from "@temporalio/workflow";
import type * as activities from "./activities";

const { addTen, multiplyByTwo, subtractFive } = proxyActivities<
  typeof activities
>({
  startToCloseTimeout: "10 seconds",
});

export const addSignalValue = defineSignal<[number]>("addSignalValue");

export interface TaskInput {
  value: number;
}

export async function simpleWorkflow(input: TaskInput): Promise<string> {
  log.info(`Starting workflow with value: ${input.value}`);

  let signalValue = 0;
  setHandler(addSignalValue, (value: number) => {
    log.info(`Received signal with value: ${value}`);
    signalValue += value;
  });

  // Step 1: Add 10
  const step1 = await addTen({ value: input.value });
  log.info(`After step 1: ${step1}`);

  // Step 2: Multiply by 2
  const step2 = await multiplyByTwo({ value: step1 });
  log.info(`After step 2: ${step2}`);

  // Step 3: Subtract 5
  const step3 = await subtractFive({ value: step2 });
  log.info(`After step 3: ${step3}`);

  const finalResult = `Complete: ${input.value} -> +10=${step1} -> *2=${step2} -> -5=${step3} + signal(${signalValue}) = ${step3 + signalValue}`;
  log.info(finalResult);
  return finalResult;
}
