from services.parser_service import parse_document_text


def test_parse_bl_returns_bl_number():
    fields = parse_document_text('dummy', 'BL')
    bl = next((f for f in fields if f.key == 'bl_number'), None)
    assert bl is not None
    assert bl.confidence > 0
