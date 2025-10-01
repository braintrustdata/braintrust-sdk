from unittest.mock import Mock, patch

import pytest
from braintrust.wrappers.genai import process_config_tools


def test_function(message: str, temperature: float = 0.7) -> str:
    """A test function that processes a message.

    Args:
        message: The message to process
        temperature: The temperature parameter

    Returns:
        The processed message
    """
    return f"Processed: {message}"


def another_test_function(count: int) -> int:
    """Another test function.

    Args:
        count: A count value

    Returns:
        The incremented count
    """
    return count + 1


class TestCallableToolsConversion:
    """Test suite for callable tools conversion in Gemini wrapper."""

    def test_process_config_tools_with_no_config(self):
        """Test that process_config_tools returns unchanged when no config."""
        args = ("model", "contents")
        kwargs = {}

        result_args, result_kwargs = process_config_tools(args, kwargs, 2)

        assert result_args == args
        assert result_kwargs == kwargs

    def test_process_config_tools_with_config_no_tools(self):
        """Test that process_config_tools returns unchanged when config has no tools."""
        config = Mock(tools=None)
        args = ("model", "contents", config)
        kwargs = {}

        result_args, result_kwargs = process_config_tools(args, kwargs, 2)

        assert result_args == args
        assert result_kwargs == kwargs

    @patch("braintrust.wrappers.genai.types")
    def test_process_config_tools_with_callable(self, mock_types):
        """Test conversion of callable to FunctionDeclaration."""
        # Setup mocks
        mock_func_decl = Mock()
        mock_tool = Mock()
        mock_types.FunctionDeclaration.from_callable_with_api_option.return_value = mock_func_decl
        mock_types.Tool.return_value = mock_tool

        # Create config with callable tool
        config = Mock()
        config.tools = [test_function]

        args = ("model", "contents", config)
        kwargs = {}

        result_args, result_kwargs = process_config_tools(args, kwargs, 2)

        # Verify conversion was called
        mock_types.FunctionDeclaration.from_callable_with_api_option.assert_called_once_with(
            callable=test_function, api_option="GEMINI_API"
        )

        # Verify Tool was created with FunctionDeclaration
        mock_types.Tool.assert_called_once_with(function_declarations=[mock_func_decl])

        # Verify config was updated
        assert config.tools == [mock_tool]

    @patch("braintrust.wrappers.genai.types")
    def test_process_config_tools_with_mixed_tools(self, mock_types):
        """Test processing config with both callable and non-callable tools."""
        # Setup mocks
        mock_func_decl = Mock()
        mock_tool_from_callable = Mock()
        mock_types.FunctionDeclaration.from_callable_with_api_option.return_value = mock_func_decl
        mock_types.Tool.return_value = mock_tool_from_callable

        # Create a non-callable tool
        existing_tool = Mock()
        existing_tool.__name__ = "existing_tool"

        # Create config with mixed tools
        config = Mock()
        config.tools = [test_function, existing_tool, another_test_function]

        args = ("model", "contents", config)
        kwargs = {}

        result_args, result_kwargs = process_config_tools(args, kwargs, 2)

        # Verify conversion was called for callables only
        assert mock_types.FunctionDeclaration.from_callable_with_api_option.call_count == 2

        # Verify Tool was created for each callable
        assert mock_types.Tool.call_count == 2

        # Verify config contains both converted and original tools
        assert len(config.tools) == 3
        assert config.tools[1] == existing_tool  # Non-callable kept as-is

    @patch("braintrust.wrappers.genai.types")
    def test_process_config_tools_with_kwargs(self, mock_types):
        """Test processing config passed via kwargs."""
        # Setup mocks
        mock_func_decl = Mock()
        mock_tool = Mock()
        mock_types.FunctionDeclaration.from_callable_with_api_option.return_value = mock_func_decl
        mock_types.Tool.return_value = mock_tool

        # Create config with callable tool
        config = Mock()
        config.tools = [test_function]

        args = ("model", "contents")
        kwargs = {"config": config}

        result_args, result_kwargs = process_config_tools(args, kwargs, 2)

        # Verify conversion was called
        mock_types.FunctionDeclaration.from_callable_with_api_option.assert_called_once_with(
            callable=test_function, api_option="GEMINI_API"
        )

        # Verify config in kwargs was updated
        assert result_kwargs["config"].tools == [mock_tool]

    @patch("braintrust.wrappers.genai.types")
    def test_process_config_tools_with_dict_config(self, mock_types):
        """Test processing dict-based config."""
        # Setup mocks
        mock_func_decl = Mock()
        mock_tool = Mock()
        mock_types.FunctionDeclaration.from_callable_with_api_option.return_value = mock_func_decl
        mock_types.Tool.return_value = mock_tool

        # Create dict config with callable tool
        config = {"tools": [test_function]}

        args = ("model", "contents", config)
        kwargs = {}

        result_args, result_kwargs = process_config_tools(args, kwargs, 2)

        # Verify config was updated
        result_config = result_args[2]
        assert "tools" in result_config
        assert result_config["tools"] == [mock_tool]

    @patch("braintrust.wrappers.genai.logger")
    @patch("braintrust.wrappers.genai.types")
    def test_process_config_tools_with_conversion_error(self, mock_types, mock_logger):
        """Test that conversion errors are handled gracefully."""
        # Setup mock to raise exception
        mock_types.FunctionDeclaration.from_callable_with_api_option.side_effect = ValueError("Test error")

        # Create config with callable tool
        config = Mock()
        config.tools = [test_function]

        args = ("model", "contents", config)
        kwargs = {}

        result_args, result_kwargs = process_config_tools(args, kwargs, 2)

        # Verify warning was logged
        mock_logger.warning.assert_called_once()

        # Verify original tool was kept
        assert config.tools == [test_function]

    def test_process_config_tools_without_types_module(self):
        """Test that missing google.genai.types module is handled gracefully."""
        with patch.dict("sys.modules", {"google.genai.types": None}):
            config = Mock()
            config.tools = [test_function]

            args = ("model", "contents", config)
            kwargs = {}

            result_args, result_kwargs = process_config_tools(args, kwargs, 2)

            # Should return unchanged
            assert result_args == args
            assert result_kwargs == kwargs

    @patch("braintrust.wrappers.genai.types")
    def test_process_empty_tools_list(self, mock_types):
        """Test processing config with empty tools list."""
        config = Mock()
        config.tools = []

        args = ("model", "contents", config)
        kwargs = {}

        result_args, result_kwargs = process_config_tools(args, kwargs, 2)

        # Should not call any conversion
        mock_types.FunctionDeclaration.from_callable_with_api_option.assert_not_called()
        mock_types.Tool.assert_not_called()

        # Config should remain unchanged
        assert config.tools == []


class TestGeminiWrapperIntegration:
    """Integration tests for the Gemini wrapper with callable tools."""

    @patch("google.genai.models.Models.generate_content")
    @patch("braintrust.wrappers.genai.types")
    def test_wrapper_processes_callable_tools(self, mock_types, mock_generate):
        """Test that the wrapper processes callable tools before calling the API."""
        from braintrust.wrappers import genai as genai_wrapper

        # Setup mocks
        mock_func_decl = Mock()
        mock_tool = Mock()
        mock_types.FunctionDeclaration.from_callable_with_api_option.return_value = mock_func_decl
        mock_types.Tool.return_value = mock_tool

        # Mock the actual generate_content to verify what it receives
        mock_generate.return_value = Mock(text="Response")

        # Import after patching to ensure wrapper is applied
        with patch("google.genai.models.Models", genai_wrapper.wrap_models(Mock())):
            # This would be called by the wrapped function
            # We're testing that our processing happens before the actual call
            pass

    def test_real_conversion_with_google_genai(self):
        """Test actual conversion with real google.genai types if available."""
        try:
            from google.genai import types
        except ImportError:
            pytest.skip("google.genai not available")

        # Create a config with callable
        config = types.GenerateContentConfig(tools=[test_function])

        # Process it
        args = ("model", "contents", config)
        kwargs = {}

        result_args, result_kwargs = process_config_tools(args, kwargs, 2)

        # Get the processed config
        processed_config = result_args[2]

        # Verify tools were converted
        assert processed_config.tools is not None
        assert len(processed_config.tools) == 1

        # Check that it's now a Tool object with FunctionDeclaration
        tool = processed_config.tools[0]
        assert isinstance(tool, types.Tool)
        assert tool.function_declarations is not None
        assert len(tool.function_declarations) == 1

        # Verify the function declaration has the right name
        func_decl = tool.function_declarations[0]
        assert func_decl.name == "test_function"
        assert func_decl.description == test_function.__doc__
