from services.classifier import classify_document


def test_classifier_hint_prefers_hint():
    assert classify_document('BL', 'https://example.com/doc.pdf') == 'BL'


def test_classifier_filename_heuristic():
    assert classify_document('', 'https://example.com/my_bill_document.pdf') == 'BL'
