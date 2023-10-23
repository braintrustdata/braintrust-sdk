class RegisteredProject:
    id: str
    name: str


class DatasetConstructorArgs:
    project: RegisteredProject
    id: str
    name: str
    pinned_version: Optional[str] = None


class DatasetInsertArgs:
    input: Any
    output: Any
    metadata: Optional[Dict[str, Any]] = None
    id: Optional[str] = None
