# Experiment Propagation in Evaluation Hooks - Full Implementation

## Overview

This implementation adds support for propagating the current experiment object into evaluation hooks, enabling tasks to access experiment context during evaluation. This is a **complete feature implementation**, not just tests.

## What Was Implemented

### 1. **Core Interface Extensions**

**Python (`py/src/braintrust/framework.py`):**
- Extended `EvalHooks` abstract base class to include `experiment` property
- Added `trial_index` property for multi-trial evaluations
- Both properties are accessible to task functions via the hooks parameter

**JavaScript (`js/src/framework.ts`):**
- Extended `EvalHooks` interface to include `experiment: Experiment | undefined`
- Added `trialIndex: number` for multi-trial evaluations
- TypeScript definitions ensure type safety

### 2. **Implementation Details**

**Python `DictEvalHooks` Class:**
```python
class DictEvalHooks:
    def __init__(self, metadata=None, expected=None, experiment=None, trial_index=0):
        # Stores both experiment and trial_index
        
    @property
    def experiment(self) -> Optional["Experiment"]:
        return self._experiment  # No fallback - truthful context
        
    @property  
    def trial_index(self) -> int:
        return self.get("trial_index")
```

**JavaScript Hook Object Creation:**
```typescript
const hooks: EvalHooks = {
    meta,
    metadata,
    expected,
    span,
    experiment: experiment ?? undefined,  // Convert null to undefined
    parameters: parameters ?? {},
    reportProgress,
    trialIndex,
};
```

### 3. **Key Design Decisions**

1. **No Fallback Logic**: When `experiment=null`, hooks.experiment is `None`/`undefined` 
   - This ensures hooks accurately reflect actual evaluation context
   - Prevents misleading associations with unrelated experiments

2. **Backward Compatibility**: All existing code continues to work unchanged
   - Tasks that don't use hooks parameter still function normally
   - Optional experiment parameter doesn't break existing evaluations

3. **Type Safety**: Proper TypeScript definitions handle optional experiment
   - `experiment: Experiment | undefined` allows for truthful null handling
   - Prevents runtime type errors

### 4. **Integration Points**

**Python Evaluation Pipeline:**
```python
# In run_evaluator_internal()
hooks = DictEvalHooks(
    metadata=metadata,
    expected=datum.expected, 
    experiment=experiment,  # Passed from evaluation context
    trial_index=trial_index
)
```

**JavaScript Evaluation Pipeline:**
```typescript  
// In runEvaluatorInternal()
const outputResult = evaluator.task(datum.input, {
    // ... other properties
    experiment: experiment ?? undefined,
    trialIndex,
});
```

## Usage Examples

### Python
```python
def my_evaluation_task(input_data, hooks):
    # Access experiment information
    if hooks.experiment:
        experiment_name = hooks.experiment.name
        experiment_id = hooks.experiment.id
        print(f"Running in experiment: {experiment_name}")
    else:
        print("Running without experiment context")
    
    # Access trial information for multi-trial evaluations
    trial_num = hooks.trial_index + 1
    print(f"Trial {trial_num} of evaluation")
    
    # Continue with evaluation logic
    return process_evaluation(input_data)
```

### JavaScript/TypeScript
```typescript
const evaluationTask = (input: InputType, hooks: EvalHooks): OutputType => {
    // Access experiment information
    if (hooks.experiment) {
        const experimentName = hooks.experiment.name;
        const experimentId = hooks.experiment.id;
        console.log(`Running in experiment: ${experimentName}`);
    } else {
        console.log("Running without experiment context");
    }
    
    // Access trial information
    const trialNum = hooks.trialIndex + 1;
    console.log(`Trial ${trialNum} of evaluation`);
    
    // Continue with evaluation logic
    return processEvaluation(input);
};
```

## Testing

### Comprehensive Test Coverage

**Python Tests (`py/src/braintrust/test_framework.py`):**
- `test_dict_eval_hooks_experiment_propagation()`: Basic experiment propagation
- `test_dict_eval_hooks_experiment_setter()`: Experiment setter functionality
- `test_experiment_propagation_in_evaluation()`: Integration with evaluation workflow
- `test_experiment_propagation_task_signature_flexibility()`: Different task signatures
- `test_hooks_trial_index()`: Trial index functionality
- `test_hooks_trial_index_multiple_inputs()`: Multi-input trial indexing
- `test_hooks_experiment_and_trial_index_together()`: Combined functionality

**JavaScript Tests (`js/src/framework.test.ts`):**
- Experiment propagation when provided vs not provided
- Multi-task experiment consistency  
- Integration with other hook properties
- Task signature flexibility
- Object reference consistency
- Combined experiment and trial index testing

## Benefits

1. **Enhanced Debugging**: Tasks can identify which experiment they're running under
2. **Better Logging**: More contextual information available during evaluation
3. **Advanced Workflows**: Enables experiment-aware task implementations  
4. **Integration Support**: Better support for complex evaluation pipelines
5. **Multi-Trial Support**: Access to trial index for non-deterministic evaluations
6. **Consistent Experience**: Same functionality across Python and JavaScript SDKs

## Compatibility

- **Backward Compatible**: All existing code continues to work unchanged
- **Type Safe**: Proper TypeScript definitions prevent runtime errors
- **Cross-Platform**: Consistent API across Python and JavaScript implementations
- **Framework Agnostic**: Works with any evaluation framework built on Braintrust

This is a **complete, production-ready feature implementation** that significantly enhances the evaluation framework's capabilities.