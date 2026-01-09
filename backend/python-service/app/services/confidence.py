import re
from typing import List


def proximity_score(text: str, candidate: str, keywords: List[str]) -> float:
    if not candidate or not text:
        return 0.0
    idx = text.find(candidate)
    if idx == -1:
        return 0.0
    # find nearest keyword
    best = None
    for k in keywords:
        ki = text.find(k)
        if ki != -1:
            d = abs(ki - idx)
            if best is None or d < best:
                best = d
    if best is None:
        return 0.5
    # map distance to score: close => 1, far => 0.2
    s = max(0.0, 1.0 - (best / (len(text) + 1)))
    return float(s)


def length_score(candidate: str) -> float:
    if not candidate:
        return 0.0
    l = len(candidate)
    # ideal length between 8 and 20
    if 8 <= l <= 20:
        return 1.0
    if l < 8:
        return max(0.0, l / 8)
    return max(0.0, 20 / l)


def frequency_score(text: str, candidate: str) -> float:
    if not candidate:
        return 0.0
    cnt = text.count(candidate)
    if cnt <= 0:
        return 0.0
    return min(1.0, 0.4 + 0.2 * cnt)


def final_confidence(text: str, candidate: str, keywords: List[str]) -> float:
    p = proximity_score(text, candidate, keywords)
    l = length_score(candidate)
    f = frequency_score(text, candidate)
    # weighted sum
    score = 0.5 * p + 0.3 * l + 0.2 * f
    return round(max(0.0, min(1.0, score)), 3)
