export interface TaskInput {
  value: number;
}

export async function addTen(input: TaskInput): Promise<number> {
  console.log(`Adding 10 to ${input.value}`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const result = input.value + 10;
  console.log(`Result: ${input.value} + 10 = ${result}`);
  return result;
}

export async function multiplyByTwo(input: TaskInput): Promise<number> {
  console.log(`Multiplying ${input.value} by 2`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const result = input.value * 2;
  console.log(`Result: ${input.value} * 2 = ${result}`);
  return result;
}

export async function subtractFive(input: TaskInput): Promise<number> {
  console.log(`Subtracting 5 from ${input.value}`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const result = input.value - 5;
  console.log(`Result: ${input.value} - 5 = ${result}`);
  return result;
}
