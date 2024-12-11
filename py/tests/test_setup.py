import requests
import responses


def test_responses_setup():
    """Verify that responses library is working correctly."""
    with responses.RequestsMock() as rsps:
        rsps.add(
            responses.GET,
            "https://api.example.com/test",
            json={"status": "ok"},
            status=200,
        )

        response = requests.get("https://api.example.com/test")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}
