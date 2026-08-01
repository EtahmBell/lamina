from lamina_directory.common import build_display_name, fts_prefix_query


def test_display_name() -> None:
    assert build_display_name("Amy", "J", "Chen", "", "MD") == "Amy J Chen, MD"


def test_fts_prefix_query() -> None:
    assert fts_prefix_query("Amy Chen") == '"Amy"* "Chen"*'
