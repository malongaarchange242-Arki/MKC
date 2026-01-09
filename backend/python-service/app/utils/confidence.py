def score_confidence(raw_score: float) -> float:
    # clamp 0..1
    return max(0.0, min(1.0, raw_score))
