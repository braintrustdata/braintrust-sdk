"""Tests for framework2 module, specifically metadata support."""

import importlib.util
from unittest.mock import MagicMock

import pytest

from .framework2 import (
    ProjectIdCache,
    projects,
)

# Check if pydantic is available
HAS_PYDANTIC = importlib.util.find_spec("pydantic") is not None


class TestCodeFunctionMetadata:
    """Tests for CodeFunction metadata support."""

    def test_code_function_with_metadata(self):
        """Test that CodeFunction stores metadata correctly."""
        project = projects.create("test-project")
        metadata = {"version": "1.0", "author": "test"}

        tool = project.tools.create(
            handler=lambda x: x,
            name="test-tool",
            parameters=None,
            metadata=metadata,
        )

        assert tool.metadata == metadata
        assert tool.name == "test-tool"
        assert tool.slug == "test-tool"

    def test_code_function_without_metadata(self):
        """Test that CodeFunction works without metadata."""
        project = projects.create("test-project")

        tool = project.tools.create(
            handler=lambda x: x,
            name="test-tool",
            parameters=None,
        )

        assert tool.metadata is None


class TestCodePromptMetadata:
    """Tests for CodePrompt metadata support."""

    def test_code_prompt_with_metadata(self):
        """Test that CodePrompt stores metadata correctly."""
        project = projects.create("test-project")
        metadata = {"category": "greeting", "priority": "high"}

        prompt = project.prompts.create(
            name="test-prompt",
            prompt="Hello {{name}}",
            model="gpt-4",
            metadata=metadata,
        )

        assert prompt.metadata == metadata
        assert prompt.name == "test-prompt"

    def test_code_prompt_without_metadata(self):
        """Test that CodePrompt works without metadata."""
        project = projects.create("test-project")

        prompt = project.prompts.create(
            name="test-prompt",
            prompt="Hello {{name}}",
            model="gpt-4",
        )

        assert prompt.metadata is None

    def test_code_prompt_to_function_definition_includes_metadata(self):
        """Test that to_function_definition includes metadata when present."""
        project = projects.create("test-project")
        metadata = {"version": "2.0", "tag": "production"}

        prompt = project.prompts.create(
            name="test-prompt",
            prompt="Hello {{name}}",
            model="gpt-4",
            metadata=metadata,
        )

        mock_project_ids = MagicMock(spec=ProjectIdCache)
        mock_project_ids.get.return_value = "project-123"

        func_def = prompt.to_function_definition(None, mock_project_ids)

        assert func_def["metadata"] == metadata
        assert func_def["name"] == "test-prompt"
        assert func_def["project_id"] == "project-123"

    def test_code_prompt_to_function_definition_excludes_metadata_when_none(self):
        """Test that to_function_definition excludes metadata when None."""
        project = projects.create("test-project")

        prompt = project.prompts.create(
            name="test-prompt",
            prompt="Hello {{name}}",
            model="gpt-4",
        )

        mock_project_ids = MagicMock(spec=ProjectIdCache)
        mock_project_ids.get.return_value = "project-123"

        func_def = prompt.to_function_definition(None, mock_project_ids)

        assert "metadata" not in func_def


class TestScorerMetadata:
    """Tests for Scorer metadata support."""

    @pytest.mark.skipif(not HAS_PYDANTIC, reason="pydantic not installed")
    def test_code_scorer_with_metadata(self):
        """Test that code scorer stores metadata correctly."""
        from pydantic import BaseModel

        class ScorerInput(BaseModel):
            output: str
            expected: str

        project = projects.create("test-project")
        metadata = {"type": "accuracy", "version": "1.0"}

        def my_scorer(output: str, expected: str) -> float:
            return 1.0 if output == expected else 0.0

        scorer = project.scorers.create(
            handler=my_scorer,
            name="test-scorer",
            parameters=ScorerInput,
            metadata=metadata,
        )

        assert scorer.metadata == metadata
        assert scorer.name == "test-scorer"

    def test_llm_scorer_with_metadata(self):
        """Test that LLM scorer stores metadata correctly."""
        project = projects.create("test-project")
        metadata = {"type": "llm_classifier", "version": "2.0"}

        scorer = project.scorers.create(
            name="llm-scorer",
            prompt="Is this correct?",
            model="gpt-4",
            use_cot=True,
            choice_scores={"yes": 1.0, "no": 0.0},
            metadata=metadata,
        )

        assert scorer.metadata == metadata
        assert scorer.name == "llm-scorer"


@pytest.mark.skipif(not HAS_PYDANTIC, reason="pydantic not installed")
class TestPushMetadata:
    """Tests for metadata in push command serialization."""

    def test_collect_function_function_defs_includes_metadata(self):
        """Test that _collect_function_function_defs includes metadata."""
        from pydantic import BaseModel

        from .cli.push import _collect_function_function_defs
        from .framework2 import global_

        class ToolInput(BaseModel):
            value: int

        project = projects.create("test-project")
        metadata = {"version": "1.0", "author": "test"}

        global_.functions.clear()

        tool = project.tools.create(
            handler=lambda x: x,
            name="test-tool",
            parameters=ToolInput,
            metadata=metadata,
        )
        global_.functions.append(tool)

        mock_project_ids = MagicMock(spec=ProjectIdCache)
        mock_project_ids.get.return_value = "project-123"

        functions = []
        _collect_function_function_defs(mock_project_ids, functions, "bundle-123", "error")

        assert len(functions) == 1
        assert functions[0]["metadata"] == metadata
        assert functions[0]["name"] == "test-tool"

        global_.functions.clear()

    def test_collect_function_function_defs_excludes_metadata_when_none(self):
        """Test that _collect_function_function_defs excludes metadata when None."""
        from pydantic import BaseModel

        from .cli.push import _collect_function_function_defs
        from .framework2 import global_

        class ToolInput(BaseModel):
            value: int

        project = projects.create("test-project")

        global_.functions.clear()

        tool = project.tools.create(
            handler=lambda x: x,
            name="test-tool",
            parameters=ToolInput,
        )
        global_.functions.append(tool)

        mock_project_ids = MagicMock(spec=ProjectIdCache)
        mock_project_ids.get.return_value = "project-123"

        functions = []
        _collect_function_function_defs(mock_project_ids, functions, "bundle-123", "error")

        assert len(functions) == 1
        assert "metadata" not in functions[0]

        global_.functions.clear()
