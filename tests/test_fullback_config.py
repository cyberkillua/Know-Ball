from pipeline.model.engine.config import get_available_positions, load_position_config
from pipeline.model.rate import _normalize_position
from pipeline.model.reset import _get_position_bucket


def test_fullbacks_have_an_explicit_config():
    fb = load_position_config("FB")
    defender = load_position_config("DEF")

    assert "FB" in get_available_positions()
    assert fb["position"] == "FB"
    assert fb["weights"] == defender["weights"]
    assert fb["normalization"] == defender["normalization"]


def test_fullback_profile_positions_use_the_fullback_rating_bucket():
    assert _normalize_position("LB") == "FB"
    assert _normalize_position("RWB") == "FB"


def test_defender_reset_only_clears_centre_back_rating_buckets():
    rating_bucket, peer_bucket = _get_position_bucket("DEF")

    assert rating_bucket == ["DEF"]
    assert peer_bucket == ["CB", "DEF"]
