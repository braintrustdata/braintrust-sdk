"""State management for remote evaluation servers."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Dict, Optional

import braintrust
from braintrust.authorize import RequestContext


@dataclass
class UserState:
    """User state for authenticated sessions."""

    token: str
    organization_id: Optional[str] = None
    user_id: Optional[str] = None
    api_url: Optional[str] = None


def login_to_state(context: RequestContext) -> Optional[UserState]:
    """
    Authenticate a user based on the request context.
    Returns a UserState if authentication is successful, None otherwise.
    """
    if not context.token:
        return None

    # Set up API state with the provided token
    state = UserState(token=context.token)

    # Initialize a new BrainTrust logger with the token
    logger = braintrust.BrainTrust(
        api_key=context.token,
        # Use default API URL, which respects BRAINTRUST_API_URL env var
        api_url=os.environ.get("BRAINTRUST_API_URL"),
    )

    try:
        # Verify the token by making a test API call
        org_info = logger._api_call("GET", "/user/current")
        if org_info and "id" in org_info:
            state.organization_id = org_info.get("org_id")
            state.user_id = org_info.get("id")
            state.api_url = os.environ.get("BRAINTRUST_API_URL")
            return state
    except Exception:
        # If the API call fails, authentication has failed
        pass

    return None


def create_experiment(
    state: UserState, name: str, dataset_id: Optional[str] = None, tags: Optional[list] = None
) -> Dict[str, Any]:
    """
    Create a new experiment using the authenticated user state.

    Args:
        state: The authenticated user state
        name: Name of the experiment
        dataset_id: Optional dataset ID to associate with the experiment
        tags: Optional tags for the experiment

    Returns:
        Dict with the experiment information, including experimentId
    """
    # Initialize a logger with the authenticated state
    logger = braintrust.BrainTrust(api_key=state.token, api_url=state.api_url)

    # Create the experiment
    experiment = logger.init_experiment(name=name, dataset_id=dataset_id, tags=tags or [])

    # Return the experiment info
    return {
        "experimentId": experiment.id,
        "name": name,
        "organizationId": state.organization_id,
    }
