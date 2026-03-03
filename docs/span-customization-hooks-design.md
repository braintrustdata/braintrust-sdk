# Span Customization Hooks Design Document

## Overview

This document defines the design for span customization hooks that allow users to modify spans when they are created or completed. This is particularly important for auto-instrumentation, where spans are automatically created without explicit user control.

This design is intended to be **language-agnostic** and applicable across multiple SDK implementations including JavaScript, Python, Ruby, Go, C#, Rust, Java, and Swift.

## User Use Cases

### Primary Use Cases

1. **Adding Context**: Attach application-level metadata (user_id, session_id, environment, request_id) to all spans
2. **Span Naming**: Customize span names based on parameters or application context
3. **Data Enrichment**: Add computed attributes (e.g., model cost, derived metrics)
4. **PII Redaction**: Transform or redact sensitive data before logging
5. **Sampling/Filtering**: Conditionally prevent spans from being logged based on criteria
6. **Custom Metrics**: Add application-specific metrics to spans

### Example Scenarios

**Scenario 1: Multi-tenant Application**

```
User wants to add tenant_id to all LLM spans
Currently: No way to do this with auto-instrumentation
Desired: All auto-instrumented spans automatically include tenant_id
```

**Scenario 2: Cost Tracking**

```
User wants to calculate estimated cost based on token usage
Currently: Can manually compute after the fact
Desired: Automatically add cost metric to all LLM spans
```

**Scenario 3: Development vs Production**

```
User wants descriptive names in dev but sanitized names in production
Currently: Span name is fixed by instrumentation
Desired: Rename spans based on environment
```

## Core Concepts

### Span Lifecycle Events

Hooks can be invoked at three lifecycle points:

1. **onCreate**: Called when a span is created (before any data is logged)
2. **onLog**: Called when data is about to be logged to a span (allows modification)
3. **onEnd**: Called when a span ends (before final flush/export)

### Hook Context

Hooks receive contextual information about the span:

```
SpanHookContext:
  - source: Where the span originated (manual | auto-instrumentation)
  - instrumentationSource: (for auto-instrumented spans)
    - provider: Name of the instrumented library (openai | anthropic | vercel | google | etc.)
    - operation: Name of the operation (e.g., "chat.completions.create")
    - channelName: Full diagnostics channel or event name
  - originalArguments: Original function arguments (for auto-instrumentation)
```

### Hook Signatures

**onCreate Hook:**

```
Input: (span, context)
Return: void or boolean (false to prevent span creation)
```

**onLog Hook:**

```
Input: (span, logEvent, context)
Return: logEvent (modified) or null (to skip logging)
```

**onEnd Hook:**

```
Input: (span, context)
Return: void or boolean (false to prevent span from being logged)
```

---

## Unified Hook Design

### Description

A single, unified approach where hooks are defined as objects/classes/structs that implement a common interface with optional lifecycle methods. These hook objects can be:

1. **Registered globally** (apply to all spans via logger initialization)
2. **Registered per-span** (apply to a specific span instance)

The hook system treats each hook object uniformly, calling the appropriate lifecycle methods when they exist. In dynamic languages, hooks can be simple objects with methods. In statically-typed languages, hooks implement an interface/trait/protocol.

### Conceptual API

```
SpanHook interface/trait/protocol:
  - onCreate(span, context) -> void or boolean [optional]
  - onLog(span, event, context) -> event or null [optional]
  - onEnd(span, context) -> void or boolean [optional]

InitializeLogger with:
  - projectName
  - spanHooks: array of SpanHook objects

StartSpan with:
  - name
  - spanHooks: array of SpanHook objects [optional]
```

---

## Language-Specific Implementations

### JavaScript/TypeScript

**Simple object-based hooks:**

```javascript
// Define hooks as simple objects
const userContextHook = {
  onCreate(span, context) {
    span.log({
      metadata: {
        user_id: getCurrentUserId(),
        environment: process.env.NODE_ENV,
      },
    });
  },
};

const costTrackingHook = {
  onEnd(span, context) {
    if (span.spanAttributes?.type === "llm") {
      const cost = calculateCost(span.metrics);
      span.log({ metrics: { cost_usd: cost } });
    }
    return true;
  },
};

// Register globally
initLogger({
  projectName: "my-project",
  spanHooks: [userContextHook, costTrackingHook],
});

// Or per-span
const span = startSpan({
  name: "special-operation",
  spanHooks: [userContextHook],
});
```

**Class-based hooks with state:**

```javascript
class CostTrackingHook {
  constructor(costConfig) {
    this.costPerToken = costConfig;
  }

  onEnd(span, context) {
    if (span.spanAttributes?.type !== "llm") return true;

    const provider = context.instrumentationSource?.provider;
    const model = span.metadata?.model;
    const tokens = span.metrics?.total_tokens;

    if (provider && model && tokens) {
      const costKey = `${provider}:${model}`;
      const cost = this.costPerToken[costKey] || 0;
      span.log({ metrics: { estimated_cost_usd: tokens * cost } });
    }

    return true;
  }
}

// Use globally
initLogger({
  projectName: "my-project",
  spanHooks: [
    new CostTrackingHook({
      "openai:gpt-4": 0.00003,
      "anthropic:claude-3-opus": 0.000015,
    }),
  ],
});
```

**TypeScript with interface:**

```typescript
interface SpanHook {
  onCreate?(span: Span, context: SpanHookContext): void | boolean;
  onLog?(
    span: Span,
    event: LogEvent,
    context: SpanHookContext,
  ): LogEvent | null;
  onEnd?(span: Span, context: SpanHookContext): void | boolean;
}

class PIIRedactionHook implements SpanHook {
  private sensitiveFields = ["api_key", "password", "token"];

  onLog(span: Span, event: LogEvent, context: SpanHookContext): LogEvent {
    if (!event.metadata) return event;

    const redactedMetadata = { ...event.metadata };
    for (const field of this.sensitiveFields) {
      if (field in redactedMetadata) {
        redactedMetadata[field] = "[REDACTED]";
      }
    }

    return { ...event, metadata: redactedMetadata };
  }
}

initLogger({
  projectName: "my-project",
  spanHooks: [new PIIRedactionHook()],
});
```

---

### Python

**Simple dict-based hooks:**

```python
# Define hooks as simple objects with methods
class UserContextHook:
    def on_create(self, span: Span, context: SpanHookContext) -> None:
        span.log(metadata={
            "user_id": get_current_user_id(),
            "environment": os.environ.get("ENV")
        })

# Or as plain functions in a namespace
def on_end(span: Span, context: SpanHookContext) -> bool:
    if span.span_attributes.get("type") == "llm":
        cost = calculate_cost(span.metrics)
        span.log(metrics={"cost_usd": cost})
    return True

cost_tracking_hook = type('CostTrackingHook', (), {
    'on_end': staticmethod(on_end)
})()

# Register globally
init_logger(
    project_name="my-project",
    span_hooks=[UserContextHook(), cost_tracking_hook]
)

# Or per-span
span = start_span(
    name="special-operation",
    span_hooks=[UserContextHook()]
)
```

**Class-based hooks with state:**

```python
from typing import Protocol, Optional

class SpanHook(Protocol):
    """Protocol defining the span hook interface."""
    def on_create(self, span: Span, context: SpanHookContext) -> Optional[bool]:
        ...

    def on_log(self, span: Span, event: LogEvent, context: SpanHookContext) -> Optional[LogEvent]:
        ...

    def on_end(self, span: Span, context: SpanHookContext) -> Optional[bool]:
        ...


class CostTrackingHook:
    def __init__(self, cost_config: dict[str, float]):
        self.cost_per_token = cost_config

    def on_end(self, span: Span, context: SpanHookContext) -> bool:
        if span.span_attributes.get("type") != "llm":
            return True

        provider = context.instrumentation_source.provider if context.instrumentation_source else None
        model = span.metadata.get("model")
        tokens = span.metrics.get("total_tokens")

        if provider and model and tokens:
            cost_key = f"{provider}:{model}"
            cost = self.cost_per_token.get(cost_key, 0)
            span.log(metrics={"estimated_cost_usd": tokens * cost})

        return True


class PIIRedactionHook:
    def __init__(self, sensitive_fields: list[str]):
        self.sensitive_fields = sensitive_fields

    def on_log(self, span: Span, event: LogEvent, context: SpanHookContext) -> LogEvent:
        if not event.metadata:
            return event

        redacted_metadata = event.metadata.copy()
        for field in self.sensitive_fields:
            if field in redacted_metadata:
                redacted_metadata[field] = "[REDACTED]"

        return LogEvent(
            **{**event.__dict__, "metadata": redacted_metadata}
        )


# Use globally
init_logger(
    project_name="my-project",
    span_hooks=[
        CostTrackingHook({
            "openai:gpt-4": 0.00003,
            "anthropic:claude-3-opus": 0.000015
        }),
        PIIRedactionHook(["api_key", "password", "token"])
    ]
)
```

---

### Ruby

**Module-based hooks:**

```ruby
# Simple module with methods
module UserContextHook
  def self.on_create(span, context)
    span.log(metadata: {
      user_id: current_user_id,
      environment: ENV['RAILS_ENV']
    })
  end
end

# Or as a class
class CostTrackingHook
  def initialize(cost_config)
    @cost_per_token = cost_config
  end

  def on_end(span, context)
    return true unless span.span_attributes[:type] == "llm"

    provider = context.instrumentation_source&.provider
    model = span.metadata[:model]
    tokens = span.metrics[:total_tokens]

    if provider && model && tokens
      cost_key = "#{provider}:#{model}"
      cost = @cost_per_token[cost_key] || 0
      span.log(metrics: { estimated_cost_usd: tokens * cost })
    end

    true
  end
end

# Register globally
Braintrust.init_logger(
  project_name: "my-project",
  span_hooks: [
    UserContextHook,
    CostTrackingHook.new({
      "openai:gpt-4" => 0.00003,
      "anthropic:claude-3-opus" => 0.000015
    })
  ]
)

# Or per-span
span = Braintrust.start_span(
  name: "special-operation",
  span_hooks: [UserContextHook]
)
```

**Using blocks:**

```ruby
# Can also use anonymous classes or Structs
user_hook = Class.new do
  def on_create(span, context)
    span.log(metadata: { user_id: current_user_id })
  end
end.new

pii_redaction_hook = Class.new do
  def initialize(sensitive_fields)
    @sensitive_fields = sensitive_fields
  end

  def on_log(span, event, context)
    return event unless event.metadata

    redacted_metadata = event.metadata.dup
    @sensitive_fields.each do |field|
      redacted_metadata[field] = "[REDACTED]" if redacted_metadata.key?(field)
    end

    event.merge(metadata: redacted_metadata)
  end
end.new([:api_key, :password, :token])

Braintrust.init_logger(
  project_name: "my-project",
  span_hooks: [user_hook, pii_redaction_hook]
)
```

---

### Go

**Interface-based hooks:**

```go
// Define the hook interface
type SpanHook interface {
    OnCreate(span *Span, context *SpanHookContext) bool
    OnLog(span *Span, event *LogEvent, context *SpanHookContext) *LogEvent
    OnEnd(span *Span, context *SpanHookContext) bool
}

// Simple struct implementing the interface
type UserContextHook struct{}

func (h *UserContextHook) OnCreate(span *Span, context *SpanHookContext) bool {
    span.Log(LogData{
        Metadata: map[string]interface{}{
            "user_id":    getCurrentUserID(),
            "environment": os.Getenv("ENV"),
        },
    })
    return true
}

func (h *UserContextHook) OnLog(span *Span, event *LogEvent, context *SpanHookContext) *LogEvent {
    return event // No-op, just pass through
}

func (h *UserContextHook) OnEnd(span *Span, context *SpanHookContext) bool {
    return true
}

// Hook with state
type CostTrackingHook struct {
    costPerToken map[string]float64
}

func NewCostTrackingHook(costConfig map[string]float64) *CostTrackingHook {
    return &CostTrackingHook{costPerToken: costConfig}
}

func (h *CostTrackingHook) OnCreate(span *Span, context *SpanHookContext) bool {
    return true
}

func (h *CostTrackingHook) OnLog(span *Span, event *LogEvent, context *SpanHookContext) *LogEvent {
    return event
}

func (h *CostTrackingHook) OnEnd(span *Span, context *SpanHookContext) bool {
    if span.SpanAttributes["type"] != "llm" {
        return true
    }

    var provider string
    if context.InstrumentationSource != nil {
        provider = context.InstrumentationSource.Provider
    }

    model, _ := span.Metadata["model"].(string)
    tokens, _ := span.Metrics["total_tokens"].(float64)

    if provider != "" && model != "" && tokens > 0 {
        costKey := fmt.Sprintf("%s:%s", provider, model)
        cost := h.costPerToken[costKey]

        span.Log(LogData{
            Metrics: map[string]float64{
                "estimated_cost_usd": tokens * cost,
            },
        })
    }

    return true
}

// Register globally
braintrust.InitLogger(Config{
    ProjectName: "my-project",
    SpanHooks: []SpanHook{
        &UserContextHook{},
        NewCostTrackingHook(map[string]float64{
            "openai:gpt-4":            0.00003,
            "anthropic:claude-3-opus": 0.000015,
        }),
    },
})

// Or per-span
span := braintrust.StartSpan(SpanConfig{
    Name: "special-operation",
    SpanHooks: []SpanHook{
        &UserContextHook{},
    },
})
```

**Using partial interface implementation (if supported via embedding):**

```go
// Base no-op implementation
type BaseSpanHook struct{}

func (h *BaseSpanHook) OnCreate(span *Span, context *SpanHookContext) bool { return true }
func (h *BaseSpanHook) OnLog(span *Span, event *LogEvent, context *SpanHookContext) *LogEvent { return event }
func (h *BaseSpanHook) OnEnd(span *Span, context *SpanHookContext) bool { return true }

// Hooks can embed BaseSpanHook and override only what they need
type UserContextHook struct {
    BaseSpanHook
}

func (h *UserContextHook) OnCreate(span *Span, context *SpanHookContext) bool {
    span.Log(LogData{
        Metadata: map[string]interface{}{
            "user_id": getCurrentUserID(),
        },
    })
    return true
}

// Now UserContextHook automatically has no-op OnLog and OnEnd methods
```

---

### C#

**Interface-based hooks:**

```csharp
// Define the hook interface
public interface ISpanHook
{
    bool OnCreate(Span span, SpanHookContext context) => true;
    LogEvent? OnLog(Span span, LogEvent logEvent, SpanHookContext context) => logEvent;
    bool OnEnd(Span span, SpanHookContext context) => true;
}

// Simple implementation
public class UserContextHook : ISpanHook
{
    public bool OnCreate(Span span, SpanHookContext context)
    {
        span.Log(new LogData
        {
            Metadata = new Dictionary<string, object>
            {
                ["user_id"] = GetCurrentUserId(),
                ["environment"] = Environment.GetEnvironmentVariable("ENV")
            }
        });
        return true;
    }
}

// Hook with state
public class CostTrackingHook : ISpanHook
{
    private readonly Dictionary<string, double> _costPerToken;

    public CostTrackingHook(Dictionary<string, double> costConfig)
    {
        _costPerToken = costConfig;
    }

    public bool OnEnd(Span span, SpanHookContext context)
    {
        if (span.SpanAttributes?.GetValueOrDefault("type") as string != "llm")
            return true;

        var provider = context.InstrumentationSource?.Provider;
        var model = span.Metadata?.GetValueOrDefault("model") as string;
        var tokens = span.Metrics?.GetValueOrDefault("total_tokens") as double?;

        if (provider != null && model != null && tokens.HasValue)
        {
            var costKey = $"{provider}:{model}";
            var cost = _costPerToken.GetValueOrDefault(costKey, 0);

            span.Log(new LogData
            {
                Metrics = new Dictionary<string, double>
                {
                    ["estimated_cost_usd"] = tokens.Value * cost
                }
            });
        }

        return true;
    }
}

// PII Redaction hook
public class PIIRedactionHook : ISpanHook
{
    private readonly HashSet<string> _sensitiveFields;

    public PIIRedactionHook(params string[] sensitiveFields)
    {
        _sensitiveFields = new HashSet<string>(sensitiveFields);
    }

    public LogEvent? OnLog(Span span, LogEvent logEvent, SpanHookContext context)
    {
        if (logEvent.Metadata == null)
            return logEvent;

        var redactedMetadata = new Dictionary<string, object>(logEvent.Metadata);
        foreach (var field in _sensitiveFields)
        {
            if (redactedMetadata.ContainsKey(field))
            {
                redactedMetadata[field] = "[REDACTED]";
            }
        }

        return logEvent with { Metadata = redactedMetadata };
    }
}

// Register globally
Braintrust.InitLogger(new LoggerConfig
{
    ProjectName = "my-project",
    SpanHooks = new ISpanHook[]
    {
        new UserContextHook(),
        new CostTrackingHook(new Dictionary<string, double>
        {
            ["openai:gpt-4"] = 0.00003,
            ["anthropic:claude-3-opus"] = 0.000015
        }),
        new PIIRedactionHook("api_key", "password", "token")
    }
});

// Or per-span
var span = Braintrust.StartSpan(new SpanConfig
{
    Name = "special-operation",
    SpanHooks = new ISpanHook[] { new UserContextHook() }
});
```

---

### Rust

**Trait-based hooks:**

```rust
// Define the hook trait with default implementations
pub trait SpanHook: Send + Sync {
    fn on_create(&self, span: &mut Span, context: &SpanHookContext) -> bool {
        true
    }

    fn on_log(&self, span: &Span, event: LogEvent, context: &SpanHookContext) -> Option<LogEvent> {
        Some(event)
    }

    fn on_end(&self, span: &Span, context: &SpanHookContext) -> bool {
        true
    }
}

// Simple struct implementing the trait
struct UserContextHook;

impl SpanHook for UserContextHook {
    fn on_create(&self, span: &mut Span, context: &SpanHookContext) -> bool {
        let mut metadata = HashMap::new();
        metadata.insert("user_id".into(), get_current_user_id());
        metadata.insert("environment".into(), env::var("ENV").unwrap_or_default());

        span.log(LogData {
            metadata: Some(metadata),
            ..Default::default()
        });

        true
    }
}

// Hook with state
struct CostTrackingHook {
    cost_per_token: HashMap<String, f64>,
}

impl CostTrackingHook {
    fn new(cost_config: HashMap<String, f64>) -> Self {
        Self {
            cost_per_token: cost_config,
        }
    }
}

impl SpanHook for CostTrackingHook {
    fn on_end(&self, span: &Span, context: &SpanHookContext) -> bool {
        if span.span_attributes.get("type") != Some(&"llm".to_string()) {
            return true;
        }

        let provider = context
            .instrumentation_source
            .as_ref()
            .map(|s| s.provider.as_str());

        let model = span
            .metadata
            .get("model")
            .and_then(|m| m.as_str())
            .unwrap_or_default();

        let tokens = span
            .metrics
            .get("total_tokens")
            .and_then(|t| t.as_f64());

        if let (Some(provider), Some(tokens)) = (provider, tokens) {
            let cost_key = format!("{}:{}", provider, model);
            let cost = self.cost_per_token.get(&cost_key).copied().unwrap_or(0.0);

            let mut metrics = HashMap::new();
            metrics.insert("estimated_cost_usd".into(), tokens * cost);

            span.log(LogData {
                metrics: Some(metrics),
                ..Default::default()
            });
        }

        true
    }
}

// PII Redaction hook
struct PIIRedactionHook {
    sensitive_fields: Vec<String>,
}

impl PIIRedactionHook {
    fn new(sensitive_fields: Vec<String>) -> Self {
        Self { sensitive_fields }
    }
}

impl SpanHook for PIIRedactionHook {
    fn on_log(&self, span: &Span, mut event: LogEvent, context: &SpanHookContext) -> Option<LogEvent> {
        if let Some(metadata) = &mut event.metadata {
            for field in &self.sensitive_fields {
                if metadata.contains_key(field) {
                    metadata.insert(field.clone(), "[REDACTED]".into());
                }
            }
        }
        Some(event)
    }
}

// Register globally
braintrust::init_logger(Config {
    project_name: "my-project".into(),
    span_hooks: vec![
        Box::new(UserContextHook) as Box<dyn SpanHook>,
        Box::new(CostTrackingHook::new(HashMap::from([
            ("openai:gpt-4".into(), 0.00003),
            ("anthropic:claude-3-opus".into(), 0.000015),
        ]))),
        Box::new(PIIRedactionHook::new(vec![
            "api_key".into(),
            "password".into(),
            "token".into(),
        ])),
    ],
    ..Default::default()
});

// Or per-span
let span = braintrust::start_span(SpanConfig {
    name: "special-operation".into(),
    span_hooks: vec![
        Box::new(UserContextHook) as Box<dyn SpanHook>,
    ],
    ..Default::default()
});
```

---

### Java

**Interface-based hooks:**

```java
// Define the hook interface with default methods
public interface SpanHook {
    default boolean onCreate(Span span, SpanHookContext context) {
        return true;
    }

    default LogEvent onLog(Span span, LogEvent event, SpanHookContext context) {
        return event;
    }

    default boolean onEnd(Span span, SpanHookContext context) {
        return true;
    }
}

// Simple implementation
public class UserContextHook implements SpanHook {
    @Override
    public boolean onCreate(Span span, SpanHookContext context) {
        span.log(LogData.builder()
            .metadata(Map.of(
                "user_id", getCurrentUserId(),
                "environment", System.getenv("ENV")
            ))
            .build());
        return true;
    }
}

// Hook with state
public class CostTrackingHook implements SpanHook {
    private final Map<String, Double> costPerToken;

    public CostTrackingHook(Map<String, Double> costConfig) {
        this.costPerToken = new HashMap<>(costConfig);
    }

    @Override
    public boolean onEnd(Span span, SpanHookContext context) {
        if (!"llm".equals(span.getSpanAttributes().get("type"))) {
            return true;
        }

        String provider = context.getInstrumentationSource()
            .map(InstrumentationSource::getProvider)
            .orElse(null);

        String model = (String) span.getMetadata().get("model");
        Double tokens = (Double) span.getMetrics().get("total_tokens");

        if (provider != null && model != null && tokens != null) {
            String costKey = provider + ":" + model;
            double cost = costPerToken.getOrDefault(costKey, 0.0);

            span.log(LogData.builder()
                .metrics(Map.of("estimated_cost_usd", tokens * cost))
                .build());
        }

        return true;
    }
}

// PII Redaction hook
public class PIIRedactionHook implements SpanHook {
    private final Set<String> sensitiveFields;

    public PIIRedactionHook(String... sensitiveFields) {
        this.sensitiveFields = new HashSet<>(Arrays.asList(sensitiveFields));
    }

    @Override
    public LogEvent onLog(Span span, LogEvent event, SpanHookContext context) {
        if (event.getMetadata() == null) {
            return event;
        }

        Map<String, Object> redactedMetadata = new HashMap<>(event.getMetadata());
        for (String field : sensitiveFields) {
            if (redactedMetadata.containsKey(field)) {
                redactedMetadata.put(field, "[REDACTED]");
            }
        }

        return event.toBuilder()
            .metadata(redactedMetadata)
            .build();
    }
}

// Register globally
Braintrust.initLogger(LoggerConfig.builder()
    .projectName("my-project")
    .spanHooks(List.of(
        new UserContextHook(),
        new CostTrackingHook(Map.of(
            "openai:gpt-4", 0.00003,
            "anthropic:claude-3-opus", 0.000015
        )),
        new PIIRedactionHook("api_key", "password", "token")
    ))
    .build());

// Or per-span
Span span = Braintrust.startSpan(SpanConfig.builder()
    .name("special-operation")
    .spanHooks(List.of(new UserContextHook()))
    .build());
```

---

### Swift

**Protocol-based hooks:**

```swift
// Define the hook protocol with default implementations
protocol SpanHook {
    func onCreate(span: Span, context: SpanHookContext) -> Bool
    func onLog(span: Span, event: LogEvent, context: SpanHookContext) -> LogEvent?
    func onEnd(span: Span, context: SpanHookContext) -> Bool
}

// Default implementations
extension SpanHook {
    func onCreate(span: Span, context: SpanHookContext) -> Bool { true }
    func onLog(span: Span, event: LogEvent, context: SpanHookContext) -> LogEvent? { event }
    func onEnd(span: Span, context: SpanHookContext) -> Bool { true }
}

// Simple struct implementing the protocol
struct UserContextHook: SpanHook {
    func onCreate(span: Span, context: SpanHookContext) -> Bool {
        span.log(LogData(
            metadata: [
                "user_id": getCurrentUserId(),
                "environment": ProcessInfo.processInfo.environment["ENV"] ?? "unknown"
            ]
        ))
        return true
    }
}

// Hook with state
class CostTrackingHook: SpanHook {
    private let costPerToken: [String: Double]

    init(costConfig: [String: Double]) {
        self.costPerToken = costConfig
    }

    func onEnd(span: Span, context: SpanHookContext) -> Bool {
        guard span.spanAttributes?["type"] as? String == "llm" else {
            return true
        }

        guard let provider = context.instrumentationSource?.provider,
              let model = span.metadata?["model"] as? String,
              let tokens = span.metrics?["total_tokens"] as? Double else {
            return true
        }

        let costKey = "\(provider):\(model)"
        let cost = costPerToken[costKey] ?? 0.0

        span.log(LogData(
            metrics: ["estimated_cost_usd": tokens * cost]
        ))

        return true
    }
}

// PII Redaction hook
class PIIRedactionHook: SpanHook {
    private let sensitiveFields: Set<String>

    init(sensitiveFields: [String]) {
        self.sensitiveFields = Set(sensitiveFields)
    }

    func onLog(span: Span, event: LogEvent, context: SpanHookContext) -> LogEvent? {
        guard var metadata = event.metadata else {
            return event
        }

        for field in sensitiveFields {
            if metadata[field] != nil {
                metadata[field] = "[REDACTED]"
            }
        }

        var modifiedEvent = event
        modifiedEvent.metadata = metadata
        return modifiedEvent
    }
}

// Register globally
Braintrust.initLogger(LoggerConfig(
    projectName: "my-project",
    spanHooks: [
        UserContextHook(),
        CostTrackingHook(costConfig: [
            "openai:gpt-4": 0.00003,
            "anthropic:claude-3-opus": 0.000015
        ]),
        PIIRedactionHook(sensitiveFields: ["api_key", "password", "token"])
    ]
))

// Or per-span
let span = Braintrust.startSpan(SpanConfig(
    name: "special-operation",
    spanHooks: [UserContextHook()]
))
```

---

## Hook Execution Behavior

### Global Hooks

Global hooks registered via `initLogger` are executed for **all spans** created within that logger's scope:

1. Hooks are called in the order they are registered in the array
2. If a hook's `onCreate` returns `false`, the span is not created
3. If a hook's `onLog` returns `null`, the log event is skipped
4. If a hook's `onEnd` returns `false`, the span is not logged/exported
5. If a hook throws an error, it is logged but does not prevent other hooks from executing

### Span-Specific Hooks

Span-specific hooks registered via `startSpan` are executed only for **that span**:

1. Span-specific hooks are called **after** global hooks for the same lifecycle event
2. Span-specific hooks follow the same execution order and behavior as global hooks
3. Useful for adding context or behavior specific to a particular operation

### Error Handling

```
For each hook in hooks array:
  try:
    call hook.lifecycleMethod(span, context)
  catch error:
    log error ("Error in hook.lifecycleMethod: <error>")
    continue to next hook (don't break span processing)
```

---

## Usage Patterns

### Pattern 1: Simple Context Enrichment

Use simple objects/structs with only the lifecycle methods you need:

```javascript
// JavaScript
const requestContextHook = {
  onCreate(span, context) {
    span.log({
      metadata: {
        request_id: getRequestId(),
        user_id: getUserId(),
      },
    });
  },
};

initLogger({
  projectName: "my-project",
  spanHooks: [requestContextHook],
});
```

### Pattern 2: Stateful Hooks

Use classes/structs with instance variables for configuration:

```python
# Python
class CostTrackingHook:
    def __init__(self, cost_config: dict[str, float]):
        self.cost_per_token = cost_config

    def on_end(self, span: Span, context: SpanHookContext) -> bool:
        # Use self.cost_per_token to calculate cost
        ...
        return True

init_logger(
    project_name="my-project",
    span_hooks=[
        CostTrackingHook({"openai:gpt-4": 0.00003})
    ]
)
```

### Pattern 3: Reusable Hook Libraries

Package and share hooks as libraries:

```java
// Java - from a shared library
import com.company.braintrust.hooks.*;

Braintrust.initLogger(LoggerConfig.builder()
    .projectName("my-project")
    .spanHooks(List.of(
        new CompanyStandardMetadataHook(),
        new ComplianceLoggingHook(),
        new CostTrackingHook(loadCostConfig())
    ))
    .build());
```

### Pattern 4: Conditional Hook Registration

Register hooks based on environment or configuration:

```ruby
# Ruby
hooks = [UserContextHook]

if ENV['ENABLE_COST_TRACKING'] == 'true'
  hooks << CostTrackingHook.new(load_cost_config)
end

if ENV['RAILS_ENV'] == 'production'
  hooks << PIIRedactionHook.new([:api_key, :password])
end

Braintrust.init_logger(
  project_name: "my-project",
  span_hooks: hooks
)
```

### Pattern 5: Span-Specific Customization

Apply hooks to specific spans only:

```go
// Go - special span with custom validation
validationHook := &ValidationHook{
    requiredFields: []string{"user_id", "action"},
}

span := braintrust.StartSpan(SpanConfig{
    Name: "critical-operation",
    SpanHooks: []SpanHook{validationHook},
})
```

---

## Implementation Considerations

### Language-Specific Details

| Language   | Hook Type      | Optional Methods          | State Management    |
| ---------- | -------------- | ------------------------- | ------------------- |
| JavaScript | Object/Class   | Duck typing               | Instance variables  |
| Python     | Class/Protocol | Duck typing               | Instance attributes |
| Ruby       | Module/Class   | Duck typing               | Instance variables  |
| Go         | Interface      | Embed base struct         | Struct fields       |
| C#         | Interface      | Default methods (C# 8+)   | Properties          |
| Rust       | Trait          | Default implementations   | Struct fields       |
| Java       | Interface      | Default methods (Java 8+) | Instance fields     |
| Swift      | Protocol       | Protocol extensions       | Properties          |

### Performance Considerations

1. **Hook array iteration**: Minimal overhead, O(n) where n = number of hooks
2. **Method existence checks**: In dynamic languages, check if method exists before calling
3. **Error handling**: Wrap each hook call in try-catch to prevent cascading failures
4. **Memory**: Hooks are held in memory for the lifetime of the logger/span

### Thread Safety

- Hooks should be **thread-safe** if spans can be created from multiple threads
- Hook implementations should not mutate shared state without synchronization
- In concurrent languages (Go, Rust), hooks should be `Send + Sync` or equivalent

---

## Open Questions

1. **Hook Timing**: Should `onCreate` fire before or after the first log() call in instrumentation?
2. **Error Handling**: Should hook errors fail silently, log warnings, or bubble up? Current proposal: log and continue
3. **Async Hooks**: Should hooks support async operations? How to handle backpressure?
4. **Performance**: Should there be a way to disable hooks in production for performance?
5. **Hook Return Values**: Should hooks return modified data, or modify in place? Current proposal: both supported depending on lifecycle event
6. **Type Safety**: How to provide type-safe hooks in strongly-typed languages while keeping optional methods?
7. **Memory Management**: How to handle hook lifecycle in languages with different memory models?
8. **Concurrency**: How to handle hooks in concurrent scenarios (goroutines, async/await, threads)?

---

## Next Steps

1. **Requirements Validation**
   - Validate with users across different languages
   - Confirm use cases are addressed
   - Gather feedback on API ergonomics

2. **Prototype Implementation**
   - Build prototypes in JavaScript, Python, and Go
   - Test with real auto-instrumentation scenarios
   - Measure performance impact

3. **API Refinement**
   - Finalize hook interface signatures
   - Define error handling behavior
   - Document edge cases

4. **Documentation**
   - Write comprehensive guides with examples
   - Create cookbook of common hook patterns
   - Document best practices per language

5. **Implementation Rollout**
   - Implement in priority languages first
   - Gather early feedback
   - Iterate and expand to remaining languages

6. **Testing**
   - Unit tests for hook execution
   - Integration tests with auto-instrumentation
   - Performance benchmarks
   - Cross-language consistency tests
